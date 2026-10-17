import asyncio
from contextlib import contextmanager
import os
import smtplib
import sqlite3
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import HTTPException, Response
from pydantic import ValidationError
from starlette.requests import Request

from backend import main


@contextmanager
def isolated_database():
    uri = f"file:email-test-{id(object())}?mode=memory&cache=shared"
    keeper = sqlite3.connect(uri, uri=True)

    def connect():
        connection = sqlite3.connect(uri, uri=True, factory=main.SQLiteConnection)
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
                await main.login(
                    main.LoginInput(identity="user@example.com", password="password"),
                    Response(),
                    Request({"type": "http", "method": "POST", "path": "/api/auth/login", "headers": []}),
                )

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
            post.return_value.status_code = 201
            post.return_value.text = '{"messageId":"test-message-id"}'

            sent = main.send_email("recipient@example.com", "123456")

        self.assertTrue(sent)
        smtp_ssl.assert_not_called()
        smtp.assert_not_called()
        post.assert_called_once()
        url = post.call_args.args[0]
        request = post.call_args.kwargs
        self.assertEqual(url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(request["headers"]["api-key"], "test-api-key")
        self.assertEqual(request["headers"]["content-type"], "application/json")
        self.assertEqual(request["json"]["sender"]["name"], "Navo AI")
        self.assertEqual(
            request["json"]["sender"]["email"],
            "verified@example.com",
        )
        self.assertEqual(request["json"]["to"], [{"email": "recipient@example.com"}])
        self.assertIn("Navo AI", request["json"]["subject"])
        self.assertIn("123456", request["json"]["textContent"])
        self.assertIn("123456", request["json"]["htmlContent"])

    def test_brevo_logs_response_status_and_sanitized_body(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "test-api-key",
            "BREVO_SENDER_EMAIL": "verified@example.com",
        }
        response = httpx.Response(
            201,
            json={"messageId": "accepted recipient@example.com"},
            request=httpx.Request("POST", "https://api.brevo.com/v3/smtp/email"),
        )
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main.httpx, "post", return_value=response),
        ):
            with self.assertLogs("uvicorn.error", level="INFO") as captured:
                sent = main.send_email("recipient@example.com", "123456")

        self.assertTrue(sent)
        diagnostic = "\n".join(captured.output)
        self.assertIn("status=201", diagnostic)
        self.assertIn("messageId", diagnostic)
        self.assertNotIn("test-api-key", diagnostic)
        self.assertNotIn("verified@example.com", diagnostic)
        self.assertNotIn("recipient@example.com", diagnostic)
        self.assertNotIn("123456", diagnostic)

    def test_brevo_http_failures_are_classified_and_not_reported_as_sent(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "test-api-key",
            "BREVO_SENDER_EMAIL": "verified@example.com",
        }
        categories = {
            401: "invalid_or_revoked_api_key",
            400: "invalid_request_or_unverified_sender",
            403: "IP_restriction_or_account_access",
        }
        for status, category in categories.items():
            with self.subTest(status=status):
                response = httpx.Response(
                    status,
                    json={
                        "message": f"Brevo rejection test-api-key recipient@example.com 123456",
                    },
                    request=httpx.Request("POST", "https://api.brevo.com/v3/smtp/email"),
                )
                with (
                    patch.dict(os.environ, environment, clear=True),
                    patch.object(main.httpx, "post", return_value=response),
                ):
                    with self.assertLogs("uvicorn.error", level="ERROR") as captured:
                        sent = main.send_email("recipient@example.com", "123456")

                self.assertFalse(sent)
                diagnostic = "\n".join(captured.output)
                self.assertIn(f"status={status}", diagnostic)
                self.assertIn(f"category={category}", diagnostic)
                self.assertIn("Brevo rejection", diagnostic)
                self.assertNotIn("test-api-key", diagnostic)
                self.assertNotIn("recipient@example.com", diagnostic)
                self.assertNotIn("123456", diagnostic)

    def test_brevo_requires_api_key_and_sender(self):
        with patch.dict(os.environ, {"EMAIL_PROVIDER": "brevo"}, clear=True):
            self.assertFalse(main.email_delivery_configured())

    def test_production_registration_does_not_fall_back_to_hidden_demo_code(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "",
            "BREVO_SENDER_EMAIL": "",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main, "is_production", return_value=True),
        ):
            self.assertEqual(main.channel_for("user@example.com"), "email")

    def test_register_reports_failed_email_without_claiming_it_was_sent(self):
        environment = {
            "EMAIL_PROVIDER": "brevo",
            "BREVO_API_KEY": "test-api-key",
            "BREVO_SENDER_EMAIL": "verified@example.com",
        }
        connection = MagicMock()
        connection.__enter__.return_value = connection
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/auth/register",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        })
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(main, "rate_limit"),
            patch.object(main, "find_user", return_value=None),
            patch.object(main.password_hash, "hash", return_value="hashed-password"),
            patch.object(main, "db", return_value=connection),
            patch.object(main, "issue_code", new=AsyncMock(return_value=(None, False))),
        ):
            result = asyncio.run(main.register(
                main.RegisterInput(
                    email="user@example.com",
                    password="long-enough-password",
                    nickname="Test User",
                ),
                request,
            ))

        self.assertEqual(result["channel"], "email")
        self.assertFalse(result["email_sent"])
        self.assertIn("emailini yubormadi", result["message"])
        self.assertNotIn("email orqali yuborildi", result["message"])

    def test_startup_logs_sqlite_and_brevo_configuration_without_values(self):
        with (
            patch.dict(
                os.environ,
                {
                    "EMAIL_PROVIDER": "brevo",
                    "BREVO_API_KEY": "do-not-log-this-key",
                    "BREVO_SENDER_EMAIL": "private-sender@example.com",
                },
                clear=True,
            ),
            patch.object(main, "DATABASE_URL", ""),
            patch.object(main, "is_production", return_value=True),
        ):
            with self.assertLogs("uvicorn.error", level="INFO") as captured:
                asyncio.run(main.verify_email_transport_on_startup())

        diagnostic = "\n".join(captured.output)
        self.assertIn("SQLite vaqtinchalik, qayta ishga tushganda akkauntlar o'chadi", diagnostic)
        self.assertIn("BREVO_API_KEY=configured", diagnostic)
        self.assertIn("BREVO_SENDER_EMAIL=configured", diagnostic)
        self.assertNotIn("do-not-log-this-key", diagnostic)
        self.assertNotIn("private-sender@example.com", diagnostic)

    def test_startup_warns_when_brevo_settings_are_missing(self):
        with (
            patch.dict(os.environ, {"EMAIL_PROVIDER": "brevo"}, clear=True),
            patch.object(main, "DATABASE_URL", "postgresql://configured"),
        ):
            with self.assertLogs("uvicorn.error", level="WARNING") as captured:
                asyncio.run(main.verify_email_transport_on_startup())

        diagnostic = "\n".join(captured.output)
        self.assertIn("BREVO_API_KEY", diagnostic)
        self.assertIn("BREVO_SENDER_EMAIL", diagnostic)
        self.assertIn("missing", diagnostic)

    def test_verify_otp_rejects_missing_expired_wrong_and_blank_codes(self):
        with isolated_database():
            with self.assertRaises(HTTPException) as missing:
                main.check_code("user@example.com", "123456", "register")
            self.assertEqual(missing.exception.status_code, 400)
            self.assertIn("topilmadi", missing.exception.detail)

            with main.db() as connection:
                connection.execute(
                    "INSERT INTO codes VALUES (?, ?, ?, ?, ?)",
                    ("user@example.com", "hash", int(main.time.time()) - 1, "register", 0),
                )
                connection.commit()
            with self.assertRaises(HTTPException) as expired:
                main.check_code("user@example.com", "123456", "register")
            self.assertEqual(expired.exception.status_code, 400)
            self.assertIn("muddati tugagan", expired.exception.detail)

            with main.db() as connection:
                connection.execute(
                    "UPDATE codes SET expires_at=?, purpose=? WHERE destination=?",
                    (int(main.time.time()) + 300, "register", "user@example.com"),
                )
                connection.commit()
            with self.assertRaises(HTTPException) as wrong:
                main.check_code("user@example.com", "123456", "reset")
            self.assertEqual(wrong.exception.status_code, 400)

            with self.assertRaises(ValidationError):
                main.CodeInput(destination="user@example.com", code="", purpose="register")

    def test_verify_otp_blank_code_is_http_422_before_handler_runs(self):
        from starlette.testclient import TestClient

        response = TestClient(main.app).post(
            "/api/auth/verify-otp",
            json={"destination": "user@example.com", "code": "", "purpose": "register"},
        )

        self.assertEqual(response.status_code, 422)

    def test_login_401_is_unknown_user_or_bad_password_and_unverified_is_403(self):
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        })

        async def call_login(user, password_valid):
            with (
                patch.object(main, "rate_limit"),
                patch.object(main, "find_user", return_value=user),
                patch.object(main.password_hash, "verify", return_value=password_valid),
            ):
                return await main.login(
                    main.LoginInput(identity="user@example.com", password="provided-password"),
                    Response(),
                    request,
                )

        for user, password_valid in ((None, False), ({"password_hash": "hash"}, False)):
            with self.subTest(user=user, password_valid=password_valid):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(call_login(user, password_valid))
                self.assertEqual(raised.exception.status_code, 401)

        unverified_user = {"password_hash": "hash", "verified": False}
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(call_login(unverified_user, True))
        self.assertEqual(raised.exception.status_code, 403)
        self.assertIn("hali tasdiqlanmagan", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
