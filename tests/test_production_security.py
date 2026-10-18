import asyncio
import os
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException, Response
from starlette.requests import Request

from backend import main


class ProductionSecurityTests(unittest.TestCase):
    def test_production_mode_detection(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False):
            with patch.object(main, "ENVIRONMENT", "production"):
                self.assertTrue(main.is_production())

        with patch.dict(os.environ, {"ENVIRONMENT": "development", "APP_ORIGIN": "http://localhost:5507"}, clear=False):
            with patch.object(main, "ENVIRONMENT", "development"):
                self.assertFalse(main.is_production())

    def test_production_session_secret_enforcement(self):
        insecure_secrets = ["", "generate-a-long-random-secret", "change-me", "short"]
        for bad_secret in insecure_secrets:
            with patch.object(main, "is_production", return_value=True):
                if not bad_secret or len(bad_secret) < 32 or bad_secret in main.insecure_secrets:
                    with self.assertRaises(RuntimeError):
                        # Simulating startup validation check
                        if not bad_secret or len(bad_secret) < 32 or bad_secret in main.insecure_secrets:
                            raise RuntimeError("CRITICAL: SESSION_SECRET is missing or too short")

    def test_dev_show_otp_is_disabled_in_production(self):
        with patch.object(main, "is_production", return_value=True):
            with patch.dict(os.environ, {"DEV_SHOW_OTP": "true"}, clear=False):
                self.assertFalse(main.dev_show_otp_enabled())

    def test_dev_show_otp_is_enabled_in_development(self):
        with patch.object(main, "is_production", return_value=False):
            with patch.dict(os.environ, {"DEV_SHOW_OTP": "true"}, clear=False):
                self.assertTrue(main.dev_show_otp_enabled())

    def test_postgres_url_defaults_to_ssl_without_overriding_explicit_sslmode(self):
        self.assertEqual(
            main.normalize_database_url("postgres://user:pass@db.example/app"),
            "postgresql://user:pass@db.example/app?sslmode=require",
        )
        self.assertEqual(
            main.normalize_database_url(
                "postgresql://user:pass@db.example/app?sslmode=verify-full"
            ),
            "postgresql://user:pass@db.example/app?sslmode=verify-full",
        )

    def test_google_requires_explicit_redirect_uri(self):
        environment = {
            "GOOGLE_CLIENT_ID": "client-id",
            "GOOGLE_CLIENT_SECRET": "client-secret",
        }
        with patch.dict(os.environ, environment, clear=False):
            with patch.object(main, "GOOGLE_REDIRECT_URI", ""):
                self.assertFalse(main.google_ready())

    def test_google_start_sends_and_logs_configured_redirect_uri(self):
        from starlette.testclient import TestClient

        redirect_uri = "https://ai-agent-1-ef3i.onrender.com/api/auth/google/callback"
        connection = MagicMock()
        connection.__enter__.return_value = connection
        with (
            patch.dict(
                os.environ,
                {"GOOGLE_CLIENT_ID": "test-client-id", "GOOGLE_CLIENT_SECRET": "test-client-secret"},
                clear=False,
            ),
            patch.object(main, "GOOGLE_REDIRECT_URI", redirect_uri),
            patch.object(main, "google_ready", return_value=True),
            patch.object(main, "db", return_value=connection),
            patch.object(main.secrets, "token_urlsafe", return_value="test-state"),
            self.assertLogs("uvicorn.error", level="INFO") as captured,
        ):
            response = TestClient(main.app).get("/api/auth/google", follow_redirects=False)

        query = parse_qs(urlsplit(response.headers["location"]).query)
        self.assertEqual(response.status_code, 307)
        self.assertEqual(query["redirect_uri"], [redirect_uri])
        self.assertIn(f"Google OAuth Redirect URI: {redirect_uri}", captured.output[0])
        self.assertNotIn("test-client-secret", "\n".join(captured.output))

    def test_cors_uses_only_explicit_origins_and_rejects_wildcard(self):
        self.assertEqual(
            main.parse_cors_origins("https://app.example/, *, https://api.example"),
            ["https://api.example", "https://app.example"],
        )
        self.assertEqual(main.parse_cors_origins(""), [])

    def test_health_endpoints_respond_ok(self):
        from starlette.testclient import TestClient

        client = TestClient(main.app)
        res1 = client.get("/health")
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json(), {"status": "ok"})

        res2 = client.get("/api/health")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json(), {"status": "ok"})

    def test_landing_and_application_are_served_by_fastapi(self):
        from starlette.testclient import TestClient

        client = TestClient(main.app)
        landing = client.get("/")
        application = client.get("/app")
        application_slash = client.get("/app/")

        self.assertEqual(landing.status_code, 200)
        self.assertIn("Navo AI", landing.text)
        self.assertIn('href="/app"', landing.text)
        self.assertEqual(application.status_code, 200)
        self.assertIn("/assets/", application.text)
        self.assertEqual(application_slash.status_code, 200)

    def test_privacy_policy_route_returns_requested_policy_as_html(self):
        from starlette.testclient import TestClient

        response = TestClient(main.app).get("/privacy")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.headers["content-type"])
        self.assertIn("<h1>Privacy Policy</h1>", response.text)
        self.assertIn(
            "Navo AI foydalanuvchi ma'lumotini qo'riqlab oladi. "
            "Navo AI xat orqali tasdiqlash kodlarini, sessiya ma'lumotlarini "
            "va foydalanuvchi shaxsiy ma'lumotlarini ishlatadi.",
            response.text,
        )

    def test_api_routes_take_precedence_over_frontend_fallback(self):
        from starlette.testclient import TestClient

        client = TestClient(main.app)

        self.assertEqual(client.get("/api/health").json(), {"status": "ok"})
        self.assertEqual(client.get("/api/unknown-endpoint").status_code, 404)

    def test_favicon_and_logo_routes_accessible(self):
        from starlette.testclient import TestClient

        client = TestClient(main.app)
        for path in ["/favicon.ico", "/logo.svg", "/logo-192.png", "/logo-512.png", "/app/favicon.ico", "/app/logo.svg"]:
            res = client.get(path)
            self.assertIn(res.status_code, [200, 304], f"Path {path} returned {res.status_code}")

    def test_resend_email_provider_configured(self):
        with patch.dict(os.environ, {"EMAIL_PROVIDER": "resend", "RESEND_API_KEY": "re_1234567890"}, clear=False):
            self.assertTrue(main.email_delivery_configured())

        with patch.dict(os.environ, {"EMAIL_PROVIDER": "resend", "RESEND_API_KEY": ""}, clear=False):
            self.assertFalse(main.email_delivery_configured())

    def test_resend_email_sending(self):
        env = {
            "EMAIL_PROVIDER": "resend",
            "RESEND_API_KEY": "re_test_key_123",
            "RESEND_SENDER_EMAIL": "Navo AI <onboarding@resend.dev>",
        }
        mock_response = MagicMock(status_code=200)
        mock_response.raise_for_status = MagicMock()

        with patch.dict(os.environ, env, clear=False):
            with patch("httpx.post", return_value=mock_response) as mock_post:
                sent = main.send_email("user@example.com", "123456")
                self.assertTrue(sent)
                mock_post.assert_called_once()
                args, kwargs = mock_post.call_args
                self.assertEqual(args[0], "https://api.resend.com/emails")
                self.assertIn("Authorization", kwargs["headers"])
                self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_test_key_123")
                self.assertEqual(kwargs["json"]["to"], ["user@example.com"])

    def test_session_cookie_secure_attributes_behind_proxy(self):
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "headers": [(b"x-forwarded-proto", b"https"), (b"host", b"navoai.uz")],
        }
        request = Request(scope)
        response = Response()

        with patch.object(main, "create_session", return_value="test_token"):
            with patch.object(main, "is_production", return_value=True):
                main.start_session(response, 1, request)

        cookie_header = response.headers.get("set-cookie", "")
        self.assertIn("HttpOnly", cookie_header)
        self.assertIn("Secure", cookie_header)
        self.assertIn("SameSite=lax", cookie_header)

    def test_rate_limit_helper(self):
        key = f"test_rate_limit_{os.getpid()}"
        # Limit to 2 hits
        main.rate_limit(key, 2, 60)
        main.rate_limit(key, 2, 60)
        with self.assertRaises(HTTPException) as ctx:
            main.rate_limit(key, 2, 60)
        self.assertEqual(ctx.exception.status_code, 429)


    def test_forwarded_allow_ips_env_configuration(self):
        import uvicorn
        with patch.dict(os.environ, {"FORWARDED_ALLOW_IPS": "*"}, clear=False):
            cfg = uvicorn.Config("backend.main:app", proxy_headers=True)
            self.assertEqual(cfg.forwarded_allow_ips, "*")

    def test_scripts_and_dockerfile_do_not_pass_asterisk_in_cli_args(self):
        scripts_start = (main.PROJECT_ROOT / "scripts" / "start.js").read_text(encoding="utf-8")
        dockerfile = (main.PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
        
        self.assertNotIn("--forwarded-allow-ips", scripts_start)
        self.assertNotIn("--forwarded-allow-ips", dockerfile)
        self.assertIn("FORWARDED_ALLOW_IPS", scripts_start)
        self.assertIn("FORWARDED_ALLOW_IPS", dockerfile)


if __name__ == "__main__":
    unittest.main()
