import asyncio
import base64
import io
import unittest
import zipfile
from unittest.mock import AsyncMock, MagicMock

import httpx

from backend import main


class BackendErrorHandlingTests(unittest.TestCase):
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
