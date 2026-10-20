import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from backend import main


class UserPreferencesTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.database_patch = patch.object(main, "DB", Path(self.temp_directory.name) / "test.db")
        self.url_patch = patch.object(main, "DATABASE_URL", "")
        self.database_patch.start()
        self.url_patch.start()
        main.init_db()
        with main.db() as connection:
            connection.execute(
                "INSERT INTO users(email, verified, created_at) VALUES (?, 1, ?)",
                ("first@example.com", int(time.time())),
            )
            connection.execute(
                "INSERT INTO users(email, verified, created_at) VALUES (?, 1, ?)",
                ("second@example.com", int(time.time())),
            )
            connection.execute(
                "INSERT INTO conversations(user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (1, "First user's conversation", int(time.time()), int(time.time())),
            )
            connection.execute(
                "INSERT INTO conversations(user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (2, "Second user's conversation", int(time.time()), int(time.time())),
            )
        self.first_token = main.create_session(1)
        self.second_token = main.create_session(2)
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.database_patch.stop()
        self.url_patch.stop()
        self.temp_directory.cleanup()

    def test_preferences_are_saved_and_loaded_from_database(self):
        self.client.cookies.set("session", self.first_token)
        saved = self.client.patch(
            "/api/preferences",
            json={
                "settings": {
                    "theme": "light",
                    "compact": True,
                    "font": "katta",
                    "enterToSend": False,
                },
                "starred_conversations": [1, 1],
                "drafts": {"new": "Keyinroq davom ettiraman", "1": "Suhbat qoralamasi"},
            },
        )

        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["starred_conversations"], [1])
        self.assertEqual(saved.json()["drafts"]["1"], "Suhbat qoralamasi")

        self.client.cookies.delete("session")
        self.client.cookies.set("session", self.first_token)
        loaded = self.client.get("/api/preferences")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json()["settings"]["theme"], "light")
        self.assertEqual(loaded.json()["starred_conversations"], [1])
        self.assertEqual(loaded.json()["drafts"]["new"], "Keyinroq davom ettiraman")

    def test_preferences_cannot_reference_another_users_conversation(self):
        self.client.cookies.set("session", self.first_token)
        response = self.client.patch(
            "/api/preferences",
            json={"starred_conversations": [2]},
        )
        self.assertEqual(response.status_code, 404)

    def test_deleting_conversation_also_removes_its_saved_preferences(self):
        self.client.cookies.set("session", self.first_token)
        saved = self.client.patch(
            "/api/preferences",
            json={"starred_conversations": [1], "drafts": {"1": "Saqlangan qoralama"}},
        )
        self.assertEqual(saved.status_code, 200, saved.text)

        deleted = self.client.delete("/api/conversations/1")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        loaded = self.client.get("/api/preferences")

        self.assertEqual(loaded.json()["starred_conversations"], [])
        self.assertEqual(loaded.json()["drafts"], {})

    def test_preferences_reject_unknown_settings_and_oversized_drafts(self):
        self.client.cookies.set("session", self.first_token)
        unknown_setting = self.client.patch(
            "/api/preferences",
            json={"settings": {"sessionSecret": "not-allowed"}},
        )
        oversized_draft = self.client.patch(
            "/api/preferences",
            json={"drafts": {"new": "x" * 50_001}},
        )

        self.assertEqual(unknown_setting.status_code, 422)
        self.assertEqual(oversized_draft.status_code, 422)

    def test_preferences_require_an_authenticated_user(self):
        self.assertEqual(self.client.get("/api/preferences").status_code, 401)
        self.assertEqual(
            self.client.patch("/api/preferences", json={"settings": {"theme": "light"}}).status_code,
            401,
        )


if __name__ == "__main__":
    unittest.main()
