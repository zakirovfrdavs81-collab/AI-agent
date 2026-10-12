import asyncio
import os
import smtplib
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException, Response

from backend import main


class EmailDeliveryTests(unittest.TestCase):
    def test_smtp_keeps_implicit_tls_on_port_465(self):
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
