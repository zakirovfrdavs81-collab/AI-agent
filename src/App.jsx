import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Activity, ArrowLeft, ArrowRight, AudioLines, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, Code2, Command, Copy, FileArchive, FileAudio2, FileCode2,
  FileImage, FileSpreadsheet, FileText, ImagePlus, Lightbulb, LogIn, LogOut,
  Menu, MessageSquare, Moon, MoreHorizontal, Paperclip, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, Search, Send, Settings2, ShieldCheck, Sparkles,
  Sun, Trash2, Upload, UserRound, X, Zap,
} from "lucide-react";
import { apiRequest, post } from "./api.js";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 4;
const ALLOWED_FILES = ".txt,.md,.csv,.tsv,.json,.jsonl,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.rs,.go,.rb,.php,.swift,.kt,.sql,.yml,.yaml,.toml,.ini,.cfg,.conf,.log,.sh,.bat,.ps1,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.epub,.zip,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.mov,.webm,.mpeg,.mpg";
const SUGGESTIONS = [
  { icon: Code2, label: "Dasturlash", prompt: "Menga React'da zamonaviy va tez ishlaydigan web-loyiha tuzib ber." },
  { icon: Lightbulb, label: "O‘rganish", prompt: "Qiyin mavzuni sodda qilib, misollar bilan tushuntirib ber." },
  { icon: Clock3, label: "Rejalashtirish", prompt: "Bugungi kunim uchun bajarilishi oson, aniq reja tuzib ber." },
  { icon: Sparkles, label: "Ijod", prompt: "Yangi va noodatiy g‘oyalar topishda yordam ber." },
];
const FORMAT_LABELS = {
  ".pdf": "PDF hujjatlar", ".docx": "Word hujjatlar", ".xlsx": "Excel jadvallar",
  ".pptx": "PowerPoint taqdimotlar", ".odt": "OpenDocument matnlari",
  ".ods": "OpenDocument jadvallari", ".odp": "OpenDocument taqdimotlari",
  ".epub": "EPUB kitoblar", ".zip": "ZIP arxivlar", ".csv": "CSV / TSV",
  ".json": "JSON", ".xml": "XML / HTML", ".py": "Python va kod",
  ".mp3": "Ovoz", ".mp4": "Video", ".png": "Rasm",
};

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(file) {
  const ext = file.name.toLowerCase().split(".").pop();
  if (/^(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/.test(ext)) return FileImage;
  if (/^(mp3|wav|m4a|ogg|flac|aac|mp4|mov|webm|mpeg|mpg)$/.test(ext)) return FileAudio2;
  if (/^(xlsx|ods|tsv)$/.test(ext)) return FileSpreadsheet;
  if (ext === "zip") return FileArchive;
  if (/^(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|rs|go|rb|php|swift|kt|sql|sh|bat|ps1)$/.test(ext)) return FileCode2;
  return FileText;
}

function initials(name = "Navo") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("register");
  const [authStage, setAuthStage] = useState("identity");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [authForm, setAuthForm] = useState({ identity: "", password: "", nickname: "", code: "" });
  const [verificationTarget, setVerificationTarget] = useState("");
  const [config, setConfig] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [search, setSearch] = useState("");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dialog, setDialog] = useState("");
  const [profile, setProfile] = useState({ nickname: "", avatar: "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [toast, setToast] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [settings, setSettings] = useState(() => {
    try {
      return {
        theme: localStorage.getItem("navo-theme") || "dark",
        compact: localStorage.getItem("navo-compact") === "true",
        sound: localStorage.getItem("navo-sound") === "true",
        enterToSend: localStorage.getItem("navo-enter-send") !== "false",
      };
    } catch {
      return { theme: "dark", compact: false, sound: false, enterToSend: true };
    }
  });
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const composerRef = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadConversations = useCallback(async () => {
    const data = await apiRequest("/conversations");
    setConversations(data.conversations || []);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([apiRequest("/me"), apiRequest("/config")])
      .then(([session, options]) => {
        if (!mounted) return;
        setConfig(options);
        if (session.authenticated) {
          setUser(session.user);
          setProfile({ nickname: session.user.nickname || "", avatar: session.user.avatar || "" });
          loadConversations().catch((error) => notify(error.message));
        } else {
          const errorCode = new URLSearchParams(window.location.search).get("auth_error");
          const messages = {
            google_config: "Google orqali kirish hali sozlanmagan. Serverdagi OAuth sozlamalarini tekshiring.",
            google_state: "Google orqali kirish sessiyasi eskirdi. Qayta urinib ko‘ring.",
            google_failed: "Google orqali kirib bo‘lmadi. Sozlamalarni tekshirib, qayta urinib ko‘ring.",
          };
          if (messages[errorCode]) {
            setAuthError(messages[errorCode]);
            const url = new URL(window.location.href);
            url.searchParams.delete("auth_error");
            window.history.replaceState(window.history.state, "", url);
          }
        }
      })
      .catch((error) => { if (mounted) setAuthError(error.message); })
      .finally(() => { if (mounted) setAuthReady(true); });
    return () => { mounted = false; };
  }, [loadConversations, notify]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.compact = String(settings.compact);
    try {
      localStorage.setItem("navo-theme", settings.theme);
      localStorage.setItem("navo-compact", String(settings.compact));
      localStorage.setItem("navo-sound", String(settings.sound));
      localStorage.setItem("navo-enter-send", String(settings.enterToSend));
    } catch {
      setToast("Brauzer sozlamalarni saqlashga ruxsat bermadi.");
    }
  }, [settings]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? conversations.filter((item) => item.title.toLowerCase().includes(query)) : conversations;
  }, [conversations, search]);
  const welcome = messages.length === 0;

  useEffect(() => {
    function onKeyDown(event) {
      const typing = event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector("#chat-search")?.focus();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        composerRef.current?.form?.requestSubmit();
      } else if (event.key === "Escape" && dialog) setDialog("");
      else if (event.key === "/" && !typing && user) {
        event.preventDefault();
        composerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, user]);

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");
    setAuthBusy(true);
    try {
      if (authMode === "reset" && authStage === "code") {
        await post("/auth/reset", { destination: verificationTarget, code: authForm.code.trim(), password: authForm.password });
        setAuthMode("login");
        setAuthStage("identity");
        setAuthNotice("Parol yangilandi. Endi yangi parol bilan tizimga kiring.");
        setAuthForm((value) => ({ ...value, password: "", code: "" }));
      } else if (authMode === "register" && authStage === "code") {
        const result = await post("/auth/verify", { destination: verificationTarget, code: authForm.code.trim(), purpose: "register" });
        finishLogin(result.user);
      } else if (authMode === "register") {
        const identity = authForm.identity.trim();
        const result = await post("/auth/register", {
          email: identity.includes("@") ? identity : null,
          phone: identity.includes("@") ? null : identity,
          nickname: authForm.nickname.trim(),
          password: authForm.password,
        });
        setVerificationTarget(identity);
        setAuthStage("code");
        setAuthNotice(result.message);
        setDemoCode(result.demo_code || "");
      } else {
        const result = await post("/auth/login", { identity: authForm.identity.trim(), password: authForm.password });
        finishLogin(result.user);
      }
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  function finishLogin(nextUser) {
    setUser(nextUser);
    setProfile({ nickname: nextUser.nickname || nextUser.name || "", avatar: nextUser.avatar || "" });
    setAuthError("");
    setAuthNotice("");
    loadConversations().catch((error) => notify(error.message));
  }

  async function requestPasswordReset() {
    const destination = authForm.identity.trim();
    if (!destination) { setAuthError("Avval email yoki telefon raqamingizni kiriting."); return; }
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await post("/auth/forgot", { destination });
      setVerificationTarget(destination);
      setAuthMode("reset");
      setAuthStage("code");
      setAuthNotice(result.message);
      setDemoCode(result.demo_code || "");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendCode() {
    if (!verificationTarget) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await post("/auth/resend", { destination: verificationTarget, purpose: authMode === "reset" ? "reset" : "register" });
      setAuthNotice(result.message);
      setDemoCode(result.demo_code || "");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      await post("/auth/logout", {});
      setUser(null);
      setMessages([]);
      setConversationId(null);
      setConversations([]);
      setAuthMode("login");
      setAuthStage("identity");
      setAuthForm({ identity: "", password: "", nickname: "", code: "" });
    } catch (error) {
      notify(error.message);
    }
  }

  async function openConversation(item) {
    setConversationId(item.id);
    setChatError("");
    setMobileSidebar(false);
    try {
      const data = await apiRequest(`/conversations/${item.id}`);
      setMessages(data.messages || []);
    } catch (error) {
      setConversationId(null);
      setChatError(error.message);
    }
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setFiles([]);
    setChatError("");
    setMobileSidebar(false);
    composerRef.current?.focus();
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setFiles((current) => {
      const next = [...current];
      let issue = "";
      for (const file of incoming) {
        if (next.length >= MAX_FILES) { issue = `Bir xabarga ko‘pi bilan ${MAX_FILES} ta fayl biriktiriladi.`; break; }
        if (!ALLOWED_FILES.split(",").some((ext) => file.name.toLowerCase().endsWith(ext))) {
          issue = `${file.name}: bu fayl turi qo‘llab-quvvatlanmaydi.`;
          continue;
        }
        if (file.size > MAX_FILE_BYTES) { issue = `${file.name}: bitta fayl 12 MB dan oshmasligi kerak.`; continue; }
        if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file);
      }
      if (issue) setChatError(issue);
      return next;
    });
  }

  async function handleSend(event) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (sending || (!prompt && !files.length)) return;
    setSending(true);
    setChatError("");
    const userText = prompt || "Biriktirilgan fayl(lar)ni tahlil qilib bering.";
    setMessages((current) => [...current, { role: "user", content: userText, files: files.map((file) => file.name) }]);
    setDraft("");
    const pendingFiles = [...files];
    setFiles([]);
    try {
      let activeId = conversationId;
      if (!activeId) {
        const created = await post("/conversations", { title: userText.slice(0, 72) });
        activeId = created.conversation.id;
        setConversationId(activeId);
        await loadConversations();
      }
      if (!pendingFiles.length) {
        const result = await post("/chat", { prompt: userText, conversation_id: activeId });
        setMessages((current) => [...current, { role: "assistant", content: result.text }]);
      } else {
        const attachments = await Promise.all(pendingFiles.map(async (file) => {
          const encoded = await fileAsBase64(file);
          return { name: file.name, mime_type: file.type || "application/octet-stream", data: encoded.data };
        }));
        const result = await post("/chat", { prompt: userText, conversation_id: activeId, attachments });
        setMessages((current) => [...current, { role: "assistant", content: result.text }]);
      }
      await loadConversations();
      if (settings.sound) playSentSound();
    } catch (error) {
      setChatError(error.message);
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileMessage("");
    try {
      const data = await apiRequest("/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname: profile.nickname.trim(), avatar: profile.avatar || null }),
      });
      setUser(data.user);
      setProfileMessage(data.message);
      window.setTimeout(() => setDialog(""), 850);
    } catch (error) {
      setProfileMessage(error.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function saveConversationTitle(item) {
    const title = window.prompt("Yangi suhbat nomini kiriting:", item.title);
    if (!title?.trim() || title.trim() === item.title) return;
    try {
      await apiRequest(`/conversations/${item.id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim() }) });
      await loadConversations();
    } catch (error) {
      notify(error.message);
    }
  }

  async function deleteConversation(item) {
    if (!window.confirm(`“${item.title}” suhbatini o‘chiraymi?`)) return;
    try {
      await apiRequest(`/conversations/${item.id}`, { method: "DELETE" });
      if (conversationId === item.id) startNewChat();
      await loadConversations();
      notify("Suhbat o‘chirildi.");
    } catch (error) {
      notify(error.message);
    }
  }

  function updateSetting(key, value) { setSettings((current) => ({ ...current, [key]: value })); }

  async function copyMessage(message, id) {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      notify("Nusxalab bo‘lmadi. Brauzer clipboard ruxsatini tekshiring.");
    }
  }

  async function pickAvatar(file) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 500_000) {
      setAvatarError("PNG, JPEG, WebP yoki GIF formatidagi 500 KB gacha rasm tanlang.");
      return;
    }
    try {
      const image = await fileAsBase64(file);
      setProfile((current) => ({ ...current, avatar: image.dataUrl }));
      setAvatarError("");
    } catch {
      setAvatarError("Rasmni o‘qib bo‘lmadi.");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  if (!authReady) return <div className="boot-screen"><div className="boot-orb"><Sparkles size={23} /><span /></div><p>Navo AI tayyorlanmoqda</p></div>;
  if (!user) return <AuthScreen mode={authMode} stage={authStage} busy={authBusy} error={authError} notice={authNotice} demoCode={demoCode} form={authForm} config={config}
    onMode={(mode) => { setAuthMode(mode); setAuthStage("identity"); setAuthError(""); setAuthNotice(""); setDemoCode(""); }}
    onChange={(key, value) => setAuthForm((current) => ({ ...current, [key]: value }))}
    onSubmit={submitAuth} onReset={requestPasswordReset} onResend={resendCode} />;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <button className={`sidebar-scrim ${mobileSidebar ? "visible" : ""}`} aria-label="Menyuni yopish" onClick={() => setMobileSidebar(false)} />
      <aside className={`sidebar glass-panel ${sidebarCollapsed ? "collapsed" : ""} ${mobileSidebar ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <a className="brand" href="/" onClick={(event) => event.preventDefault()}><span className="brand-icon"><Sparkles size={18} /></span><span>Navo<span className="brand-accent">.ai</span></span></a>
          <button className="icon-button sidebar-toggle" title="Yon panelni yig‘ish" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          <button className="icon-button mobile-close" title="Menyuni yopish" onClick={() => setMobileSidebar(false)}><X size={18} /></button>
        </div>
        <button className="new-chat-button" onClick={startNewChat}><Plus size={17} /><span>Yangi suhbat</span><kbd>⌘ K</kbd></button>
        <label className="search-box"><Search size={15} /><input id="chat-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Suhbatlarni izlash" /><kbd>⌘K</kbd></label>
        <div className="history-heading"><span>SO‘NGGI SUHBATLAR</span><span>{filteredConversations.length}</span></div>
        <div className="conversation-list">
          {filteredConversations.length === 0 ? <div className="history-empty"><MessageSquare size={17} /><p>{search ? "Mos suhbat topilmadi." : "Yangi suhbatlaringiz shu yerda saqlanadi."}</p></div>
            : filteredConversations.map((item) => <div className={`conversation-row ${conversationId === item.id ? "conversation-active" : ""}`} key={item.id}>
              <button className="conversation-open" onClick={() => openConversation(item)} title={item.title}><MessageSquare size={15} /><span>{item.title}</span></button>
              <span className="conversation-actions"><button title="Nomini o‘zgartirish" onClick={() => saveConversationTitle(item)}><Pencil size={13} /></button><button title="O‘chirish" onClick={() => deleteConversation(item)}><Trash2 size={13} /></button></span>
            </div>)}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-link" onClick={() => setDialog("help")}><CircleHelp size={17} /><span>Yordam markazi</span><ArrowRight size={14} /></button>
          <button className="sidebar-link" onClick={() => setDialog("settings")}><Settings2 size={17} /><span>Sozlamalar</span></button>
          <button className="account-card" onClick={() => { setProfile({ nickname: user.nickname || user.name || "", avatar: user.avatar || "" }); setDialog("profile"); }}>
            <span className="avatar">{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</span>
            <span className="account-info"><strong>{user.nickname || user.name}</strong><small>{user.email || user.phone || "Shaxsiy hisob"}</small></span><MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileSidebar(true)} title="Menyu"><Menu size={19} /></button><div className="model-select"><span className="model-spark"><Sparkles size={15} /></span><span>Navo 2.5</span><span className="model-divider" /><span className="online-dot" /><span className="model-light">Fast</span><ChevronDown size={14} /></div></div>
          <div className="topbar-right"><div className="secure-label"><ShieldCheck size={14} /><span>Shifrlangan sessiya</span></div><button className="avatar top-avatar" title="Profil sozlamalari" onClick={() => { setProfile({ nickname: user.nickname || user.name || "", avatar: user.avatar || "" }); setDialog("profile"); }}>{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</button></div>
        </header>
        <div className={`workspace ${welcome ? "workspace-welcome" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          {welcome ? <section className="welcome">
            <div className="welcome-badge"><span className="online-dot" /> SHAXSIY AI YORDAMCHINGIZ</div>
            <h1>Salom, <span>{user.nickname || user.name?.split("@")[0] || "do‘stim"}.</span><br />Bugun nimani <span className="gradient-text">yaratamiz?</span></h1>
            <p className="welcome-description">G‘oyangizni yozing yoki fayl yuboring — reja tuzish, tahlil qilish va yangi narsalarni o‘rganishda yordam beraman.</p>
            <div className="suggestion-grid">{SUGGESTIONS.map(({ icon: Icon, label, prompt }) => <button className="suggestion-card glass-panel" key={label} onClick={() => { setDraft(prompt); composerRef.current?.focus(); }}><span className="suggestion-icon"><Icon size={18} /></span><span className="suggestion-label">{label}</span><span className="suggestion-copy">{prompt}</span><ArrowRight size={15} className="suggestion-arrow" /></button>)}</div>
            <div className="welcome-footnote"><Zap size={14} /> Ko‘p formatdagi fayllarni yuklang · Tezkor yordam oling</div>
          </section> : <section className="messages" aria-live="polite">
            {messages.map((message, index) => <ChatMessage key={`${conversationId || "new"}-${index}`} message={message} copied={copiedId === index} onCopy={() => copyMessage(message.content, index)} />)}
            {sending && <div className="message assistant-message"><span className="assistant-avatar"><Sparkles size={15} /></span><div className="message-body"><div className="thinking-indicator"><span /><span /><span /></div></div></div>}
            {chatError && <div className="error-banner"><Activity size={16} /><span>{chatError}</span><button onClick={() => setChatError("")}><X size={15} /></button></div>}
            <div ref={messagesEndRef} />
          </section>}
        </div>
        <div className="composer-zone"><form className="composer glass-panel" onSubmit={handleSend}>
          {files.length > 0 && <div className="attachment-list">{files.map((file, index) => { const Icon = fileIcon(file); return <div className="attachment-chip" key={`${file.name}-${file.size}`}><span className="file-icon"><Icon size={16} /></span><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><button type="button" title="Faylni olib tashlash" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={14} /></button></div>; })}</div>}
          <textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && settings.enterToSend) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder="Xabaringizni yozing..." aria-label="Xabar matni" />
          <div className="composer-actions"><div className="composer-tools"><input ref={fileInputRef} className="visually-hidden" type="file" multiple accept={ALLOWED_FILES} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} /><button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()} title="Fayl biriktirish"><Paperclip size={17} /></button><button className="tool-button" type="button" onClick={() => setDialog("formats")} title="Qo‘llab-quvvatlanadigan fayllar"><Upload size={16} /><span>Fayl yuklash</span></button><span className="tool-divider" /><span className="format-hint">12 MB gacha · {MAX_FILES} ta fayl</span></div><button className="send-button" type="submit" disabled={sending || (!draft.trim() && files.length === 0)} title="Yuborish · Ctrl + Enter">{sending ? <span className="button-spinner" /> : <Send size={16} />}</button></div>
        </form><div className="composer-caption"><span><ShieldCheck size={13} /> Suhbatlaringiz akkauntingizda saqlanadi.</span><span>Javoblarni muhim qarorlardan oldin tekshiring.</span></div></div>
      </section>

      {dialog === "settings" && <SettingsDialog settings={settings} user={user} config={config} onChange={updateSetting} onClose={() => setDialog("")} onSignOut={signOut} />}
      {dialog === "profile" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><UserRound size={19} /></div><div><h2 id="profile-heading">Profil sozlamalari</h2><p>Hisobingizni o‘zingizga moslang.</p></div></div><form onSubmit={saveProfile}><label className="avatar-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => pickAvatar(event.target.files?.[0])} /><span className="avatar-preview">{profile.avatar ? <img src={profile.avatar} alt="Avatar" /> : initials(profile.nickname || user.name)}</span><span className="avatar-edit"><ImagePlus size={15} /></span></label><p className="avatar-caption">Profil rasmi · PNG, JPEG, WebP · 500 KB gacha</p>{profile.avatar && <button type="button" className="remove-avatar" onClick={() => setProfile((current) => ({ ...current, avatar: "" }))}>Avatarni olib tashlash</button>}<label className="field-label">Ko‘rinadigan ism<input required minLength={2} maxLength={40} value={profile.nickname} onChange={(event) => setProfile((current) => ({ ...current, nickname: event.target.value }))} placeholder="Ismingiz" /></label><label className="field-label">Email yoki telefon<div className="readonly-field">{user.email || user.phone || "—"} <ShieldCheck size={14} /></div></label>{avatarError && <p className="inline-error">{avatarError}</p>}{profileMessage && <p className="inline-success">{profileMessage}</p>}<button className="primary-button modal-action" disabled={profileBusy}>{profileBusy ? <span className="button-spinner" /> : <Check size={16} />} Saqlash</button></form></section></div>}
      {dialog === "help" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><CircleHelp size={19} /></div><div><h2 id="help-heading">Yordam markazi</h2><p>Navo AI’dan samarali foydalanish.</p></div></div><div className="help-list"><div><span>01</span><p><strong>Yaxshi savol bering</strong><br />Maqsad va kerakli formatni yozsangiz, aniqroq javob olasiz.</p></div><div><span>02</span><p><strong>Fayl yoki bir nechta hujjat yuboring</strong><br />PDF, Office, OpenDocument, rasm va boshqa formatlarni tahlil qiling.</p></div><div><span>03</span><p><strong>Sozlamalarni moslang</strong><br />Mavzu, ixcham ko‘rinish, ovoz va Enter xatti-harakatini o‘zgartiring.</p></div></div><div className="shortcut-tip"><Command size={16} /><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> xabar yuboradi · <kbd>/</kbd> yozishni boshlaydi · <kbd>Esc</kbd> oynani yopadi</span></div></section></div>}
      {dialog === "formats" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card formats-dialog" role="dialog" aria-modal="true" aria-labelledby="formats-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><FileText size={19} /></div><div><h2 id="formats-heading">Fayl formatlari</h2><p>Bir xabarga 4 tagacha, har biri 12 MB gacha.</p></div></div><div className="format-grid">{Object.entries(FORMAT_LABELS).map(([ext, label]) => <div className="format-item" key={ext}><code>{ext}</code><span>{label}</span></div>)}</div><p className="format-footnote">Word, Excel, PowerPoint va PDF matni ajratib olinadi. Rasm, ovoz va videolar AI’ga yuboriladi. Eski DOC/XLS/PPT fayllarini DOCX/XLSX/PPTX qilib saqlang.</p></section></div>}
      {toast && <div className="toast-message"><CheckCheck size={16} />{toast}</div>}
    </main>
  );
}

function AuthScreen({ mode, stage, busy, error, notice, demoCode, form, onMode, onChange, onSubmit, onReset, onResend }) {
  const resetting = mode === "reset";
  const verifying = stage === "code";
  return <main className="auth-layout"><div className="auth-glow auth-glow-one" /><div className="auth-glow auth-glow-two" />
    <section className="auth-presentation"><a className="brand auth-brand" href="/"><span className="brand-icon"><Sparkles size={18} /></span><span>Navo<span className="brand-accent">.ai</span></span></a><div className="auth-story"><div className="welcome-badge"><span className="online-dot" /> AI BILAN YANGICHA ISHLANG</div><h1>Fikringizga<br /><span className="gradient-text">aniqlik bering.</span></h1><p>G‘oyalaringizni rejalarga, savollaringizni esa tushunarli javoblarga aylantiring.</p><div className="auth-feature-list"><div><ShieldCheck size={17} /> Xavfsiz akkaunt va maxfiy suhbatlar</div><div><FileText size={17} /> Hujjatlar, rasmlar va ko‘p turdagi fayllar</div><div><AudioLines size={17} /> O‘zbek tilidagi qulay AI yordamchi</div></div></div><div className="auth-footer">Yaxshi g‘oya — yaxshi savoldan boshlanadi.</div></section>
    <section className="auth-side"><div className="auth-card glass-panel"><div className="auth-card-logo"><span className="brand-icon"><Sparkles size={17} /></span><span>Navo AI</span><span className="auth-card-secure"><ShieldCheck size={13} /> Xavfsiz</span></div><h2>{verifying ? "Hisobingizni tasdiqlang" : resetting ? "Parolni tiklash" : mode === "login" ? "Xush kelibsiz" : "Yangi hisob yarating"}</h2><p className="auth-card-subtitle">{verifying ? `Kod ${form.identity} manziliga yuborildi.` : resetting ? "Yangi parol o‘rnatish uchun tasdiqlash kodini kiriting." : mode === "login" ? "Hisobingizga kirib davom eting." : "Shaxsiy AI yordamchingizni hoziroq ishga tushiring."}</p>
      {!verifying && !resetting && <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => onMode("login")}>Kirish</button><button className={mode === "register" ? "active" : ""} onClick={() => onMode("register")}>Ro‘yxatdan o‘tish</button></div>}
      <form className="auth-form" onSubmit={onSubmit}>
        {(!verifying || resetting) && <>{!verifying && <label className="field-label">Email yoki telefon<input required autoComplete="username" placeholder="ism@gmail.com yoki +998901234567" value={form.identity} onChange={(event) => onChange("identity", event.target.value)} /></label>}{!verifying && <label className="field-label">{resetting ? "Yangi parol" : "Parol"}<input required minLength={8} autoComplete={resetting ? "new-password" : mode === "register" ? "new-password" : "current-password"} type="password" placeholder="Kamida 8 ta belgi" value={form.password} onChange={(event) => onChange("password", event.target.value)} /></label>}{mode === "register" && <label className="field-label">Ism yoki nickname<input required minLength={2} maxLength={40} autoComplete="nickname" placeholder="Masalan, Dilshod" value={form.nickname} onChange={(event) => onChange("nickname", event.target.value)} /></label>}</>}
        {verifying && <><label className="field-label">6 xonali tasdiqlash kodi<input required autoFocus inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} placeholder="000000" value={form.code} onChange={(event) => onChange("code", event.target.value.replace(/\D/g, ""))} /></label>{demoCode && <div className="demo-code-note">Sinov rejimidagi kodingiz: <strong>{demoCode}</strong></div>}<button className="text-action" type="button" disabled={busy} onClick={onResend}>Kodni qayta yuborish</button></>}
        {error && <p className="auth-feedback error-feedback" role="alert"><CircleHelp size={15} />{error}</p>}{notice && <p className="auth-feedback success-feedback"><Check size={15} />{notice}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="button-spinner" /> : <>{verifying ? <ShieldCheck size={17} /> : mode === "login" ? <LogIn size={17} /> : <ArrowRight size={17} />}{verifying ? "Tasdiqlash" : resetting ? "Parolni yangilash" : mode === "login" ? "Hisobga kirish" : "Hisob yaratish"}</>}</button>
      </form>
      {!verifying && !resetting && mode === "login" && <button className="text-action forgot-link" onClick={onReset}>Parolni unutdingizmi?</button>}
      {!verifying && !resetting && <><div className="auth-divider"><span>yoki</span></div><button className="google-auth" onClick={() => { window.location.href = "/api/auth/google"; }}><span className="google-mark">G</span> Google orqali davom etish</button></>}
      {resetting && <button className="text-action back-login" onClick={() => onMode("login")}><ArrowLeft size={14} /> Kirish sahifasiga qaytish</button>}
      <p className="auth-safety"><ShieldCheck size={13} /> Parolingiz himoyalangan holda saqlanadi.</p>
    </div><div className="auth-legal">Davom etib, foydalanish shartlariga rozilik bildirasiz.</div></section>
  </main>;
}

function ChatMessage({ message, copied, onCopy }) {
  const assistant = message.role !== "user";
  return <article className={`message ${assistant ? "assistant-message" : "user-message"}`}>{assistant ? <span className="assistant-avatar"><Sparkles size={15} /></span> : <span className="user-message-avatar"><UserRound size={15} /></span>}<div className="message-body"><div className="message-label">{assistant ? "NAVO AI" : "SIZ"}{message.attachment && <span className="answer-attachment"><Paperclip size={12} />{message.attachment}</span>}</div><div className={`message-content ${assistant ? "markdown-content" : ""}`}>{assistant ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{message.content || ""}</ReactMarkdown> : <p>{message.content}</p>}</div>{message.files?.length > 0 && <div className="message-files">{message.files.map((file) => <span key={file}><FileText size={13} />{file}</span>)}</div>}{assistant && <button className="copy-button" onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Nusxalandi" : "Javobni nusxalash"}</button>}</div></article>;
}

function SettingsDialog({ settings, user, config, onChange, onClose, onSignOut }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-heading"><ModalClose onClick={onClose} /><div className="modal-heading"><div className="modal-icon"><Settings2 size={19} /></div><div><h2 id="settings-heading">Sozlamalar</h2><p>Navo AI’ni o‘zingizga moslang.</p></div></div>
    <div className="settings-group"><h3>Ko‘rinish</h3><SettingRow icon={settings.theme === "dark" ? Moon : Sun} title="Rang mavzusi" description="Ko‘zlaringizga qulay rejimni tanlang."><div className="segmented-control"><button className={settings.theme === "dark" ? "selected" : ""} onClick={() => onChange("theme", "dark")}><Moon size={14} /> Tungi</button><button className={settings.theme === "light" ? "selected" : ""} onClick={() => onChange("theme", "light")}><Sun size={14} /> Kunduzgi</button></div></SettingRow><SettingRow icon={PanelLeftClose} title="Ixcham ko‘rinish" description="Chat ro‘yxati va xabarlar orasidagi masofani qisqartiring."><Toggle value={settings.compact} onChange={(value) => onChange("compact", value)} label="Ixcham ko‘rinish" /></SettingRow></div>
    <div className="settings-group"><h3>Yozish</h3><SettingRow icon={Command} title="Enter bilan yuborish" description="Yangi qator uchun Shift + Enter tugmalarini bosing."><Toggle value={settings.enterToSend} onChange={(value) => onChange("enterToSend", value)} label="Enter bilan yuborish" /></SettingRow><SettingRow icon={AudioLines} title="Javob ovozi" description="Javob tayyor bo‘lganda qisqa tovush eshittirish."><Toggle value={settings.sound} onChange={(value) => onChange("sound", value)} label="Javob ovozi" /></SettingRow></div>
    <div className="settings-group"><h3>Hisob va maxfiylik</h3><div className="settings-account"><span className="avatar">{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</span><span><strong>{user.nickname || user.name}</strong><small>{user.email || user.phone}</small></span><span className="verified-badge"><ShieldCheck size={13} /> himoyalangan</span></div><SettingRow icon={FileText} title="Suhbat tarixi" description="Shaxsiy suhbatlaringiz akkauntingizda saqlanadi." /><SettingRow icon={ShieldCheck} title="API ulanishi" description={config?.google_login ? "Google orqali kirish sozlangan." : "AI javoblari serverdagi Gemini kalitiga bog‘liq."} /><button className="sign-out-button" onClick={onSignOut}><LogOut size={16} /> Hisobdan chiqish</button></div><p className="settings-version">NAVO AI · WEB · 1.0</p>
  </section></div>;
}

function SettingRow({ icon: Icon, title, description, children }) {
  return <div className="setting-row"><span className="setting-row-icon"><Icon size={16} /></span><span className="setting-row-copy"><strong>{title}</strong><small>{description}</small></span>{children}</div>;
}

function Toggle({ value, onChange, label }) {
  return <button className={`toggle-switch ${value ? "toggle-on" : ""}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}><span /></button>;
}

function ModalClose({ onClick }) {
  return <button className="modal-close" aria-label="Oynani yopish" onClick={onClick}><X size={17} /></button>;
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      if (comma < 0) reject(new Error("Faylni kodlab bo‘lmadi."));
      else resolve({ data: dataUrl.slice(comma + 1), dataUrl });
    };
    reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });
}

function playSentSound() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.16);
    oscillator.onended = () => context.close();
  } catch {
    return;
  }
}