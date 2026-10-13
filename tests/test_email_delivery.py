import asyncio
from contextlib import contextmanager
import os
import smtplib
import sqlite3
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException, Response

from backend import main


@contextmanager
def isolated_database():
    uri = f"file:email-test-{id(object())}?mode=memory&cache=shared"
    keeper = sqlite3.connect(uri, uri=True)

    def connect():
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    try:
        with (
            patch.object(main, "DATABASE_URL", ""),
            patch.object(main, "db", side_effect=connect),
        ):
            connection = connect()
            try:
                connection.execute(
                    "CREATE TABLE codes ("
                    "destination TEXT PRIMARY KEY, code_hash TEXT NOT NULL, "
                    "expires_at INTEGER NOT NULL, purpose TEXT NOT NULL, "
                    "attempts INTEGER NOT NULL DEFAULT 0)"
                )
                connection.commit()
            finally:
                connection.close()
            yield
    finally:
        keeper.close()


class EmailDeliveryTests(unittest.TestCase):
    def test_smtp_keeps_implicit_tls_on_port_465(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app \t-pass\nword",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.ssl, "create_default_context"),
            patch.object(main.smtplib, "SMTP_SSL") as smtp_ssl,
            patch.object(main.smtplib, "SMTP") as smtp,
        ):
            sent = main.send_email("recipient@example.com", "123456")

        self.assertTrue(sent)
        smtp_ssl.assert_called_once()
        self.assertEqual(smtp_ssl.call_args.args[:2], ("smtp.gmail.com", 465))
        smtp_ssl.return_value.__enter__.return_value.login.assert_called_once_with(
            "sender@example.com",
            "app-password",
        )
        smtp.assert_not_called()

    def test_startup_smtp_verification_uses_implicit_tls_on_port_465(self):
        environment = {
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app \t-pass\nword",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.ssl, "create_default_context"),
            patch.object(main.smtplib, "SMTP_SSL") as smtp_ssl,
            patch.object(main.smtplib, "SMTP") as smtp,
        ):
            with self.assertLogs("uvicorn.error", level="INFO") as captured:
                self.assertTrue(main.verify_smtp_connection())

        smtp_ssl.assert_called_once()
        smtp_ssl.return_value.__enter__.return_value.login.assert_called_once_with(
            "sender@example.com",
            "app-password",
        )
        smtp.assert_not_called()
        self.assertIn("SMTP connection verified successfully", captured.output[0])

    def test_startup_hook_runs_smtp_verification(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main, "verify_smtp_connection", return_value=True) as verify,
        ):
            asyncio.run(main.verify_email_transport_on_startup())

        verify.assert_called_once_with()

    def test_smtp_disconnect_is_not_reported_as_sent(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.ssl, "create_default_context"),
            patch.object(
                main.smtplib,
                "SMTP_SSL",
                side_effect=smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
            ),
        ):
            with self.assertLogs(level="ERROR") as captured:
                sent = main.send_email("recipient@example.com", "123456")

        self.assertFalse(sent)
        diagnostic = "\n".join(captured.output)
        self.assertIn("SMTPServerDisconnected", diagnostic)
        self.assertNotIn("app-password", diagnostic)
        self.assertNotIn("recipient@example.com", diagnostic)

    def test_smtp_verification_logs_failure_without_password(self):
        environment = {
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
        }
        error = smtplib.SMTPAuthenticationError(
            535,
            b"5.7.8 authentication failed for app-password",
        )
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.ssl, "create_default_context"),
            patch.object(main.smtplib, "SMTP_SSL", side_effect=error),
        ):
            with self.assertLogs("uvicorn.error", level="ERROR") as captured:
                self.assertFalse(main.verify_smtp_connection())

        diagnostic = "\n".join(captured.output)
        self.assertIn("code=535", diagnostic)
        self.assertIn("5.7.8 authentication failed", diagnostic)
        self.assertNotIn("app-password", diagnostic)

    def test_smtp_error_logs_diagnostics_without_credentials(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
        }
        error = smtplib.SMTPAuthenticationError(
            535,
            b"5.7.8 authentication failed for app-password",
        )
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.ssl, "create_default_context"),
            patch.object(main.smtplib, "SMTP_SSL", side_effect=error),
        ):
            with self.assertLogs(level="ERROR") as captured:
                sent = main.send_email("recipient@example.com", "123456")

        self.assertFalse(sent)
        diagnostic = "\n".join(captured.output)
        self.assertIn("code=535", diagnostic)
        self.assertIn("5.7.8 authentication failed", diagnostic)
        self.assertIn("SMTPAuthenticationError", diagnostic)
        self.assertNotIn("app-password", diagnostic)
        self.assertNotIn("recipient@example.com", diagnostic)
        self.assertNotIn("123456", diagnostic)

    def test_auto_mode_sends_required_google_otp_using_email_not_eskiz(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
            "ESKIZ_EMAIL": "eskiz@example.com",
            "ESKIZ_PASSWORD": "eskiz-password",
            "OTP_MODE": "auto",
            "DEV_SHOW_OTP": "false",
        }
        with (
            isolated_database(),
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.secrets, "randbelow", return_value=123456),
            patch.object(main, "send_email", return_value=True) as send_email,
            patch.object(main, "send_sms", new=AsyncMock()) as send_sms,
        ):
            code, sent = asyncio.run(
                main.issue_code("google-user@example.com", "google", require_email=True)
            )

        self.assertEqual(code, "123456")
        self.assertTrue(sent)
        send_email.assert_called_once_with("google-user@example.com", "123456")
        send_sms.assert_not_awaited()

    def test_auto_mode_selects_smtp_for_email_registration(self):
        environment = {
            "EMAIL_PROVIDER": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_USER": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
            "ESKIZ_EMAIL": "eskiz@example.com",
            "ESKIZ_PASSWORD": "eskiz-password",
            "OTP_MODE": "auto",
            "DEV_SHOW_OTP": "false",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(main.channel_for("new-user@example.com"), "email")

    def test_dev_show_otp_logs_code_for_local_testing(self):
        environment = {
            "OTP_MODE": "auto",
            "DEV_SHOW_OTP": "true",
        }
        with (
            isolated_database(),
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.secrets, "randbelow", return_value=123456),
        ):
            with self.assertLogs(level="WARNING") as captured:
                code, sent = asyncio.run(
                    main.issue_code("local-user@example.com", "register")
                )

        self.assertEqual(code, "123456")
        self.assertTrue(sent)
        self.assertIn("DEV_SHOW_OTP=true: register OTP code: 123456", captured.output[0])

    def test_login_returns_gateway_error_when_otp_email_fails(self):
        user = {
            "id": 7,
            "password_hash": "stored-hash",
            "verified": True,
            "email": "user@example.com",
        }

        async def run_login():
            with (
                patch.object(main, "rate_limit"),
                patch.object(main, "find_user", return_value=user),
                patch.object(main.password_hash, "verify", return_value=True),
                patch.object(main, "issue_code", new=AsyncMock(return_value=(None, False))),
            ):
                await main.login(main.LoginInput(identity="user@example.com", password="valid-password"), Response())

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(run_login())

        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("Tasdiqlash emaili yuborilmadi", raised.exception.detail)

    def test_brevo_sends_transactional_email_over_https(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "test-api-key",
            "BREVO_SENDER_EMAIL": "verified@example.com",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.httpx, "post") as post,
            patch.object(main.smtplib, "SMTP_SSL") as smtp_ssl,
            patch.object(main.smtplib, "SMTP") as smtp,
        ):
            post.return_value.raise_for_status.return_value = None

            sent = main.send_email("recipient@example.com", "123456")

        self.assertTrue(sent)
        smtp_ssl.assert_not_called()
        smtp.assert_not_called()
        post.assert_called_once()
        url = post.call_args.args[0]
        request = post.call_args.kwargs
        self.assertEqual(url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(request["headers"]["api-key"], "test-api-key")
        self.assertEqual(
            request["json"]["sender"]["email"],
            "verified@example.com",
        )
        self.assertEqual(request["json"]["to"], [{"email": "recipient@example.com"}])
        self.assertIn("123456", request["json"]["textContent"])
        self.assertIn("123456", request["json"]["htmlContent"])

    def test_brevo_http_failure_is_not_reported_as_sent(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "test-api-key",
            "BREVO_SENDER_EMAIL": "verified@example.com",
        }
        response = httpx.Response(
            401,
            request=httpx.Request("POST", "https://api.brevo.com/v3/smtp/email"),
        )
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.httpx, "post", return_value=response),
        ):
            with self.assertLogs(level="ERROR") as captured:
                sent = main.send_email("recipient@example.com", "123456")

        self.assertFalse(sent)
        diagnostic = "\n".join(captured.output)
        self.assertIn("HTTPStatusError", diagnostic)
        self.assertNotIn("test-api-key", diagnostic)
        self.assertNotIn("recipient@example.com", diagnostic)

    def test_brevo_requires_api_key_and_sender(self):
        with patch.dict(os.environ, {"EMAIL_PROVIDER": "brevo"}, clear=True):
            self.assertFalse(main.email_delivery_configured())


if __name__ == "__main__":
    unittest.main()
