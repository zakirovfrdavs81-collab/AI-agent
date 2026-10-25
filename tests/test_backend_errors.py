import asyncio
import base64
import io
import unittest
import zipfile
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import HTTPException

from backend import main


class BackendErrorHandlingTests(unittest.TestCase):
    def test_chat_returns_timeout_error_when_model_discovery_hangs(self):
        async def wait_forever(*args):
            await asyncio.Event().wait()

        with (
            patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}),
            patch.object(main, "session_user", return_value={"id": 1}),
            patch.object(main, "usage_today", return_value=0),
            patch.object(main, "CHAT_REQUEST_TIMEOUT_SECONDS", 0.01),
            patch.object(main, "model_queue_for", new=AsyncMock(side_effect=wait_forever)),
            self.assertLogs(level="WARNING"),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.chat(main.ChatInput(prompt="test savol")))

        self.assertEqual(raised.exception.status_code, 504)
        self.assertIn("juda uzoq", raised.exception.detail)

    def test_chat_model_timeout_leaves_time_for_fallback_models(self):
        self.assertLess(main.CHAT_MODEL_TIMEOUT_SECONDS, main.CHAT_REQUEST_TIMEOUT_SECONDS)
        self.assertLess(main.CHAT_MODEL_TIMEOUT_SECONDS, 25)

    def test_gemini_model_discovery_handles_invalid_json(self):
        response = httpx.Response(
            200,
            content=b"<html>temporarily unavailable</html>",
            request=httpx.Request(
                "GET",
                "https://generativelanguage.googleapis.com/v1beta/models",
            ),
        )
        client = MagicMock()
        client.get = AsyncMock(return_value=response)

        with self.assertLogs(level="WARNING") as captured:
            models = asyncio.run(main.live_models(client, "test-key"))

        self.assertEqual(models, [])
        self.assertIn("invalid JSON", captured.output[0])

    def test_attachment_rejects_invalid_base64(self):
        parts, warning = main.attachment_parts("notes.txt", "text/plain", "%%%")

        self.assertEqual(parts, [])
        self.assertIn("fayl o‘qilmadi", warning)

    def test_attachment_rejects_oversized_uncompressed_archive_xml(self):
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "word/document.xml",
                "x" * (main.MAX_ARCHIVE_XML_BYTES + 1),
            )
        encoded_archive = base64.b64encode(archive_buffer.getvalue()).decode("ascii")

        parts, warning = main.attachment_parts(
            "document.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            encoded_archive,
        )

        self.assertEqual(parts, [])
        self.assertIn("hujjatni ochib", warning)


if __name__ == "__main__":
    unittest.main()
