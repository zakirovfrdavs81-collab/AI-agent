/**
 * Chat so'rovi. Gemini API kaliti hech qachon brauzerga tushmaydi: so'rov
 * shu saytning serveriga (/api/chat) yuboriladi, server esa kalitni o'zi qo'shadi.
 * Muvaffaqiyatli javob: { text, used_today, daily_limit }
 * Xato bo'lsa: status kodi biriktirilgan Error tashlanadi.
 */
async function fetchGeminiResponse(prompt, attachment = null, apiBase = "") {
    let response;
    try {
        response = await fetch(`${apiBase}/api/chat`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt,
                file_data: attachment?.data || null,
                file_type: attachment?.type || null
            })
        });
    } catch {
        throw new Error("Backend bilan aloqa yo‘q. run.bat orqali serverni ishga tushiring.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.detail || `API xatosi (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return {
        text: data.text || "Javob olinmadi.",
        used_today: data.used_today ?? 0,
        daily_limit: data.daily_limit ?? 0
    };
}
