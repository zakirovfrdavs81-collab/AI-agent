import json
import unittest

from starlette.testclient import TestClient

from backend import main


class PwaTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_manifest_is_installable_and_has_all_icon_purposes(self):
        response = self.client.get("/manifest.webmanifest")
        self.assertEqual(response.status_code, 200)
        manifest = json.loads(response.text)
        self.assertEqual(manifest["id"], "/app/")
        self.assertEqual(manifest["start_url"], "/app/")
        self.assertEqual(manifest["scope"], "/")
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["background_color"], "#10131f")
        self.assertEqual(manifest["theme_color"], "#10131f")
        self.assertEqual(
            {(icon["sizes"], icon["purpose"]) for icon in manifest["icons"]},
            {
                ("192x192", "any"),
                ("512x512", "any"),
                ("192x192", "maskable"),
                ("512x512", "maskable"),
            },
        )

    def test_all_manifest_icons_are_served(self):
        manifest = self.client.get("/manifest.webmanifest").json()
        for icon in manifest["icons"]:
            with self.subTest(icon=icon["src"]):
                response = self.client.get(icon["src"])
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.content)

    def test_manifest_and_service_worker_are_not_cached(self):
        for path in ("/manifest.webmanifest", "/sw.js"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "no-cache")

        worker = self.client.get("/sw.js")
        self.assertEqual(worker.headers["service-worker-allowed"], "/")


if __name__ == "__main__":
    unittest.main()
