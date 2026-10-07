import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Activity, ArrowLeft, ArrowRight, AudioLines, BarChart3, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, Code2, Command, Copy, Download, Eye, EyeOff, FileArchive, FileAudio2,
  FileCode2, FileDown, FileImage, FileSpreadsheet, FileText, ImagePlus, LayoutTemplate,
  Lightbulb, LogIn, LogOut, Menu, MessageSquare, Mic, MicOff, MonitorSmartphone, Moon,
  MoreHorizontal, Paperclip, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, RefreshCw,
  Search, Send, Settings2, ShieldCheck, Sparkles, Square, Star, Sun, Trash2, Upload,
  UserRound, Volume2, X, Zap,
} from "lucide-react";
import { apiRequest, post } from "./api.js";
import {
  loginAccount, logoutAccount, registerAccount, requestPasswordReset as sendPasswordReset,
  resendOtp as resendAuthOtp, resetPassword, startGoogleLogin, verifyLoginOtp, verifyOtp,
} from "./auth.js";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 4;
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;
const ALLOWED_FILES = ".txt,.md,.csv,.tsv,.json,.jsonl,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.rs,.go,.rb,.php,.swift,.kt,.sql,.yml,.yaml,.toml,.ini,.cfg,.conf,.log,.sh,.bat,.ps1,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.epub,.zip,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.mov,.webm,.mpeg,.mpg";
const SUGGESTIONS = [
  { icon: Code2, label: "Dasturlash", prompt: "Menga React'da zamonaviy va tez ishlaydigan web-loyiha tuzib ber." },
  { icon: Lightbulb, label: "O‘rganish", prompt: "Qiyin mavzuni sodda qilib, misollar bilan tushuntirib ber." },
  { icon: Clock3, label: "Rejalashtirish", prompt: "Bugungi kunim uchun bajarilishi oson, aniq reja tuzib ber." },
  { icon: Sparkles, label: "Ijod", prompt: "Yangi va noodatiy g‘oyalar topishda yordam ber." },
];
const Robot3D = lazy(() => import("./Robot3D.jsx"));
const SceneEffects = lazy(() => import("./SceneEffects.jsx"));
const FORMAT_LABELS = {
  ".pdf": "PDF hujjatlar", ".docx": "Word hujjatlar", ".xlsx": "Excel jadvallar",
  ".pptx": "PowerPoint taqdimotlar", ".odt": "OpenDocument matnlari",
  ".ods": "OpenDocument jadvallari", ".odp": "OpenDocument taqdimotlari",
  ".epub": "EPUB kitoblar", ".zip": "ZIP arxivlar", ".csv": "CSV / TSV",
  ".json": "JSON", ".xml": "XML / HTML", ".py": "Python va kod",
  ".mp3": "Ovoz", ".mp4": "Video", ".png": "Rasm",
};

const FONT_SIZES = [
  { id: "standart", label: "Standart" },
  { id: "katta", label: "Katta" },
  { id: "kattaroq", label: "Juda katta" },
];
const PROMPT_LIBRARY = [
  {
    group: "O‘rganish",
    items: [
      "Murakkab mavzuni oddiy qilib, misollar bilan tushuntirib ber.",
      "Shu mavzu bo‘yicha 10 savoldan iborat test tuzib ber, javoblari bilan.",
      "Mavzuni jadval ko‘rinishida qiyoslab ber: afzalliklar va kamchiliklar.",
    ],
  },
  {
    group: "Dasturlash",
    items: [
      "Shu kodni o‘qib, xatolarni topib, tuzatilgan variantini yozib ber.",
      "React komponentini yozib ber: izohlar va ishlatish misoli bilan.",
      "Bu SQL so‘rovni optimallashtirib, indeks bo‘yicha maslahat ber.",
    ],
  },
  {
    group: "Yozish va hujjat",
    items: [
      "Shu matnni rasmiy uslubda, xatosiz qilib qayta yoz.",
      "Uchrashuv bayoni (protokol) uchun shablon tuzib ber.",
      "Qisqa va muloyim elektron xat yozib ber.",
    ],
  },
  {
    group: "Reja va tahlil",
    items: [
      "Bu maqsad uchun 7 kunlik bosqichma-bosqich reja tuzib ber.",
      "Biznes g‘oyani kuchli va zaif tomonlari bilan tahlil qilib ber.",
      "Shu qarorni qabul qilishdan oldin hisobga olinadigan 5 xatarni ayt.",
    ],
  },
];

function formatTime(stamp) {
  if (!stamp) return "";
  const date = new Date(Number(stamp) * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(stamp) {
  if (!stamp) return "—";
  const date = new Date(Number(stamp) * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function relativeDay(stamp) {
  if (!stamp) return "";
  const days = Math.round((Date.now() - Number(stamp) * 1000) / 86_400_000);
  if (days <= 0) return "bugun";
  if (days === 1) return "kecha";
  if (days < 30) return `${days} kun oldin`;
  return formatDate(stamp);
}

function htmlToPlain(text) {
  return String(text || "").replace(/[#*`>_~]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function conversationAsMarkdown(title, messages, user) {
  const header = [
    `# ${title || "Navo AI suhbati"}`,
    "",
    `- Muallif: ${user?.nickname || user?.name || "Foydalanuvchi"}`,
    `- Yuklangan vaqt: ${new Date().toLocaleString("uz-UZ")}`,
    `- Xabarlar soni: ${messages.length}`,
    "",
  ];
  messages.forEach((message) => {
    const who = message.role === "user" ? "SIZ" : "NAVO AI";
    header.push(`## ${who}${message.at ? ` · ${formatTime(message.at)}` : ""}`, "", message.content || "", "");
    if (message.files?.length) header.push(`_Fayllar: ${message.files.join(", ")}_`, "");
  });
  return header.join("\n");
}

function safeFileName(title) {
  return (title || "navo-suhbat").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "navo-suhbat";
}

function downloadText(filename, content, type = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function recognitionSupported() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function speechChunk(text, limit = 4200) {
  const clean = htmlToPlain(text);
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function highlightMatches(text, query) {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return source;
  const lower = source.toLowerCase();
  const target = needle.toLowerCase();
  const parts = [];
  let cursor = 0;
  let index = lower.indexOf(target);
  let key = 0;
  while (index >= 0 && key < 120) {
    if (index > cursor) parts.push(source.slice(cursor, index));
    parts.push(<mark key={`match-${key}`}>{source.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = lower.indexOf(target, cursor);
    key += 1;
  }
  parts.push(source.slice(cursor));
  return parts;
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

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

function authErrorMessage(error, fallback = "Xatolik bor. Qayta urinib ko‘ring.") {
  const data = error?.response?.data;
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => item?.msg).filter(Boolean);
    if (messages.length) return messages.join(", ");
  }
  if (typeof data?.message === "string") return data.message;
  if (typeof error?.message === "string") return error.message;
  return fallback;
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
  const [expandedSuggestion, setExpandedSuggestion] = useState(null);
  const [settings, setSettings] = useState(() => ({
    theme: readStorage("navo-theme", "dark"),
    compact: readStorage("navo-compact", "false") === "true",
    sound: readStorage("navo-sound", "false") === "true",
    enterToSend: readStorage("navo-enter-send", "true") !== "false",
    font: readStorage("navo-font", "standart"),
    systemTheme: readStorage("navo-system-theme", "false") === "true",
    readAloud: readStorage("navo-read-aloud", "false") === "true",
  }));
  const [usage, setUsage] = useState({ used: 0, limit: 0 });
  const [stats, setStats] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [messageQuery, setMessageQuery] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [starOnly, setStarOnly] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return true;
    }
  });
  const [starred, setStarred] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("navo-starred") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const searchRef = useRef(null);
  const workspaceRef = useRef(null);
  const recognitionRef = useRef(null);
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
        setUsage({ used: session.used_today || 0, limit: session.daily_limit || options?.daily_limit || 0 });
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
            google_otp_setup: "Google orqali xavfsiz kirish uchun .env faylida Gmail SMTP sozlamalarini kiriting.",
            google_otp_failed: "Google tasdiqlash kodi emailga yuborilmadi. SMTP sozlamalarini tekshirib, qayta urinib ko‘ring.",
          };
          const params = new URLSearchParams(window.location.search);
          if (params.get("auth_step") === "google_otp" && params.get("destination")) {
            const destination = params.get("destination");
            setAuthMode("google");
            setAuthStage("code");
            setVerificationTarget(destination);
            setAuthForm((current) => ({ ...current, identity: destination, code: "" }));
            setDemoCode("");
            setAuthNotice("Google tasdiqlandi. Emailingizga yuborilgan 6 xonali kodni kiriting.");
            ["auth_step", "destination", "demo_code"].forEach((key) => params.delete(key));
            const url = new URL(window.location.href);
            url.search = params.toString();
            window.history.replaceState(window.history.state, "", url);
          }
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
    const light = settings.systemTheme ? !systemDark : settings.theme === "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.documentElement.dataset.compact = String(settings.compact);
    document.documentElement.dataset.font = settings.font || "standart";
    try {
      localStorage.setItem("navo-theme", settings.theme);
      localStorage.setItem("navo-compact", String(settings.compact));
      localStorage.setItem("navo-sound", String(settings.sound));
      localStorage.setItem("navo-enter-send", String(settings.enterToSend));
      localStorage.setItem("navo-font", settings.font || "standart");
      localStorage.setItem("navo-system-theme", String(settings.systemTheme));
      localStorage.setItem("navo-read-aloud", String(settings.readAloud));
    } catch {
      setToast("Brauzer sozlamalarni saqlashga ruxsat bermadi.");
    }
  }, [settings, systemDark]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = query ? conversations.filter((item) => item.title.toLowerCase().includes(query)) : conversations;
    const decorated = [...list];
    decorated.sort((left, right) => {
      const starDiff = Number(starred.includes(right.id)) - Number(starred.includes(left.id));
      if (starDiff !== 0) return starDiff;
      return (right.updated_at || 0) - (left.updated_at || 0);
    });
    return starOnly ? decorated.filter((item) => starred.includes(item.id)) : decorated;
  }, [conversations, search, starred, starOnly]);
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
        await resetPassword({ destination: verificationTarget, code: authForm.code.trim(), password: authForm.password });
        setAuthMode("login");
        setAuthStage("identity");
        setAuthNotice("Parol yangilandi. Endi yangi parol bilan tizimga kiring.");
        setAuthForm((value) => ({ ...value, password: "", code: "" }));
      } else if (authMode === "register" && authStage === "code") {
        const result = await verifyOtp({ destination: verificationTarget, code: authForm.code.trim(), purpose: "register" });
        finishLogin(result.user);
      } else if (authMode === "google" && authStage === "code") {
        const result = await verifyOtp({ destination: verificationTarget, code: authForm.code.trim(), purpose: "google" });
        finishLogin(result.user);
      } else if (authMode === "login" && authStage === "login_otp") {
        const result = await verifyLoginOtp({ email: verificationTarget, code: authForm.code.trim() });
        finishLogin(result.user);
      } else if (authMode === "register") {
        const identity = authForm.identity.trim();
        const result = await registerAccount({
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
        const result = await loginAccount({ identity: authForm.identity.trim(), password: authForm.password });
        if (result.require_otp && result.email) {
          setVerificationTarget(result.email);
          setAuthForm((current) => ({ ...current, identity: result.email, code: "" }));
          setAuthStage("login_otp");
          setAuthNotice(result.message || `Kod ${result.email} manziliga yuborildi.`);
        } else {
          throw new Error("Server OTP tasdiqlash bosqichini boshlamadi. Qayta urinib ko‘ring.");
        }
      }
    } catch (error) {
      setAuthError(authErrorMessage(error, "Amalni bajarib bo‘lmadi. Qayta urinib ko‘ring."));
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
      const result = await sendPasswordReset({ destination });
      setVerificationTarget(destination);
      setAuthMode("reset");
      setAuthStage("code");
      setAuthNotice(result.message);
      setDemoCode(result.demo_code || "");
    } catch (error) {
      setAuthError(authErrorMessage(error, "Parolni tiklash kodini yuborib bo‘lmadi. Qayta urinib ko‘ring."));
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendCode() {
    if (!verificationTarget || authBusy) return false;
    setAuthBusy(true);
    setAuthError("");
    try {
      const purpose = authMode === "reset" ? "reset" : authMode === "google" ? "google" : authStage === "login_otp" ? "login" : "register";
      const result = await resendAuthOtp({ destination: verificationTarget, purpose });
      setAuthNotice(result.message);
      setDemoCode(result.demo_code || "");
      return true;
    } catch (error) {
      setAuthError(authErrorMessage(error, "Tasdiqlash kodini yuborib bo‘lmadi. Qayta urinib ko‘ring."));
      return false;
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      await logoutAccount();
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

  async function handleSend(event, override = {}) {
    event?.preventDefault();
    const prompt = (override.prompt ?? draft).trim();
    const pendingFiles = override.prompt ? [] : [...files];
    if (sending || (!prompt && !pendingFiles.length)) return;
    setSending(true);
    setChatError("");
    const userText = prompt || "Biriktirilgan fayl(lar)ni tahlil qilib bering.";
    const stamp = Math.floor(Date.now() / 1000);
    setMessages((current) => [...current, { role: "user", content: userText, files: pendingFiles.map((file) => file.name), at: stamp }]);
    if (!override.prompt) setDraft("");
    setFiles([]);
    try {
      const attachments = await Promise.all(pendingFiles.map(async (file) => {
        const encoded = await fileAsBase64(file);
        return { name: file.name, mime_type: file.type || "application/octet-stream", data: encoded.data };
      }));
      const result = await post("/chat", { prompt: userText, conversation_id: conversationId || null, attachments });
      if (result.conversation_id) setConversationId(result.conversation_id);
      if (typeof result.used_today === "number") setUsage({ used: result.used_today, limit: result.daily_limit || usage.limit });
      if (result.notes?.length) notify(result.notes.join(" "));
      setMessages((current) => [...current, { role: "assistant", content: result.text, at: Math.floor(Date.now() / 1000) }]);
      await loadConversations();
      if (settings.sound) playSentSound();
      if (settings.readAloud) speakAnswer(result.text, "auto");
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
    setDropActive(false);
    addFiles(event.dataTransfer.files);
  }

  // --- Kengaytirilgan imkoniyatlar ------------------------------------------
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query?.addEventListener) return undefined;
    const listener = (event) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("navo-starred", JSON.stringify(starred));
    } catch {
      /* brauzer saqlashga ruxsat bermadi */
    }
  }, [starred]);

  useEffect(() => {
    setDraft(readStorage(`navo-draft-${conversationId || "new"}`, ""));
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`navo-draft-${conversationId || "new"}`, draft);
      } catch {
        /* brauzer saqlashga ruxsat bermadi */
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, conversationId]);

  useEffect(() => () => {
    if (speechSupported()) window.speechSynthesis.cancel();
    try {
      recognitionRef.current?.abort?.();
    } catch {
      /* allaqachon to‘xtagan */
    }
  }, []);

  const visibleMessages = useMemo(() => {
    const query = messageQuery.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((message) => String(message.content || "").toLowerCase().includes(query));
  }, [messages, messageQuery]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await apiRequest("/stats"));
    } catch (error) {
      notify(error.message);
    }
  }, [notify]);

  useEffect(() => {
    if (dialog === "stats" || dialog === "profile") loadStats();
  }, [dialog, loadStats]);

  function conversationTitle() {
    return conversations.find((item) => item.id === conversationId)?.title || "Yangi suhbat";
  }

  function exportConversation(kind) {
    setActionsOpen(false);
    if (!messages.length) {
      notify("Eksport qilish uchun suhbat bo‘sh.");
      return;
    }
    const title = conversationTitle();
    if (kind === "json") {
      downloadText(
        `${safeFileName(title)}.json`,
        JSON.stringify({ title, exported_at: new Date().toISOString(), messages }, null, 2),
        "application/json;charset=utf-8",
      );
    } else if (kind === "txt") {
      const body = messages
        .map((message) => `${message.role === "user" ? "SIZ" : "NAVO AI"}: ${htmlToPlain(message.content)}`)
        .join("\n\n");
      downloadText(`${safeFileName(title)}.txt`, `${title}\n\n${body}\n`, "text/plain;charset=utf-8");
    } else {
      downloadText(`${safeFileName(title)}.md`, conversationAsMarkdown(title, messages, user));
    }
    notify("Suhbat yuklab olindi.");
  }

  async function copyConversation() {
    setActionsOpen(false);
    if (!messages.length) {
      notify("Nusxalash uchun suhbat bo‘sh.");
      return;
    }
    try {
      await navigator.clipboard.writeText(conversationAsMarkdown(conversationTitle(), messages, user));
      notify("Butun suhbat nusxalandi.");
    } catch {
      notify("Nusxalab bo‘lmadi. Brauzer ruxsatini tekshiring.");
    }
  }

  function printConversation() {
    setActionsOpen(false);
    window.setTimeout(() => window.print(), 120);
  }

  function toggleStar(item, event) {
    event?.stopPropagation();
    setStarred((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]));
  }

  function editMessage(message) {
    setDraft(message.content || "");
    composerRef.current?.focus();
    notify("Matn tahrirlash uchun maydonga qo‘yildi.");
  }

  function resendMessage(message) {
    if (sending) return;
    handleSend(null, { prompt: message.content || "" });
  }

  function useTemplate(prompt) {
    setDraft(prompt);
    setDialog("");
    window.setTimeout(() => composerRef.current?.focus(), 90);
  }

  function jumpToBottom() {
    const node = workspaceRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    else messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setShowJump(false);
  }

  function trackScroll(event) {
    const node = event.currentTarget;
    setShowJump(node.scrollHeight - node.scrollTop - node.clientHeight > 240);
  }

  function speakAnswer(text, id = "auto") {
    if (!speechSupported()) {
      notify("Bu brauzer javobni ovozli o‘qishni qo‘llamaydi.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechChunk(text));
    utterance.lang = "uz-UZ";
    utterance.rate = 1;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }

  function toggleReadAloud(message, id) {
    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    speakAnswer(message.content, id);
  }

  function stopVoice() {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      /* allaqachon to‘xtagan */
    }
    recognitionRef.current = null;
    setVoiceBusy(false);
  }

  function toggleVoice() {
    if (voiceBusy) {
      stopVoice();
      return;
    }
    if (!recognitionSupported()) {
      notify("Ovoz bilan yozish Chrome yoki Edge brauzerida ishlaydi.");
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = "uz-UZ";
    recognition.continuous = false;
    recognition.interimResults = false;
    const base = draft.trim();
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results).map((item) => item[0].transcript).join(" ").trim();
      if (spoken) setDraft(base ? `${base} ${spoken}` : spoken);
    };
    recognition.onerror = () => {
      setVoiceBusy(false);
      notify("Ovozni o‘qib bo‘lmadi. Mikrofon ruxsatini tekshiring.");
    };
    recognition.onend = () => setVoiceBusy(false);
    recognitionRef.current = recognition;
    setVoiceBusy(true);
    try {
      recognition.start();
    } catch {
      setVoiceBusy(false);
      notify("Mikrofonni ishga tushirib bo‘lmadi.");
    }
  }

  useEffect(() => {
    function onShortcut(event) {
      if (!user) return;
      const typing = event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        startNewChat();
      } else if (meta && !event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
      } else if (meta && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearching(true);
        window.setTimeout(() => searchRef.current?.focus(), 90);
      } else if (meta && event.key === "/") {
        event.preventDefault();
        setDialog((current) => (current ? "" : "help"));
      } else if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        exportConversation("md");
      } else if (event.key === "Escape" && voiceBusy) {
        stopVoice();
      } else if (event.key === "Escape" && searching && !typing) {
        setSearching(false);
        setMessageQuery("");
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  });

  if (!authReady) return <div className="boot-screen"><div className="boot-orb"><Sparkles size={23} /><span /></div><p>Navo AI tayyorlanmoqda</p></div>;
  if (!user) return <>
    <Suspense fallback={null}><SceneEffects /></Suspense>
    <AuthScreen mode={authMode} stage={authStage} busy={authBusy} error={authError} notice={authNotice} demoCode={demoCode} form={authForm} config={config}
      onMode={(mode) => { setAuthMode(mode); setAuthStage("identity"); setVerificationTarget(""); setAuthError(""); setAuthNotice(""); setDemoCode(""); }}
      onChange={(key, value) => setAuthForm((current) => ({ ...current, [key]: value }))}
      onSubmit={submitAuth} onReset={requestPasswordReset} onResend={resendCode} />
  </>;

  return (
    <main className="app-shell">
      <Suspense fallback={null}><SceneEffects /></Suspense>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <button className={`sidebar-scrim ${mobileSidebar ? "visible" : ""}`} aria-label="Menyuni yopish" onClick={() => setMobileSidebar(false)} />
      <aside className={`sidebar glass-panel ${sidebarCollapsed ? "collapsed" : ""} ${mobileSidebar ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <a className="brand" href="/" onClick={(event) => event.preventDefault()}><span className="brand-mark"><img alt="Navo AI" src={LOGO_SRC} /></span><span>Navo<span className="brand-accent">.ai</span></span></a>
          <button className="icon-button sidebar-toggle" title="Yon panelni yig‘ish" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          <button className="icon-button mobile-close" title="Menyuni yopish" onClick={() => setMobileSidebar(false)}><X size={18} /></button>
        </div>
        <button className="new-chat-button" onClick={startNewChat}><Plus size={17} /><span>Yangi suhbat</span><kbd>⌘ K</kbd></button>
        <label className="search-box"><Search size={15} /><input id="chat-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Suhbatlarni izlash" /><kbd>⌘K</kbd></label>
        <div className="history-heading"><span>SO‘NGGI SUHBATLAR</span><span className="history-tools"><button type="button" className={starOnly ? "filter-chip active" : "filter-chip"} onClick={() => setStarOnly((value) => !value)} title="Faqat yulduzli suhbatlar"><Star size={12} />{starred.length}</button><span>{filteredConversations.length}</span></span></div>
        <div className="conversation-list">
          {filteredConversations.length === 0 ? <div className="history-empty"><MessageSquare size={17} /><p>{search ? "Mos suhbat topilmadi." : "Yangi suhbatlaringiz shu yerda saqlanadi."}</p></div>
            : filteredConversations.map((item) => <div className={`conversation-row ${conversationId === item.id ? "conversation-active" : ""}`} key={item.id}>
              <button className="conversation-open" onClick={() => openConversation(item)} title={item.title}><MessageSquare size={15} /><span>{item.title}</span></button>
              <span className="conversation-actions"><button className={starred.includes(item.id) ? "star-button starred" : "star-button"} title={starred.includes(item.id) ? "Yulduzdan olib tashlash" : "Yulduzga qo‘shish"} onClick={(event) => toggleStar(item, event)}><Star size={13} /></button><button title="Nomini o‘zgartirish" onClick={() => saveConversationTitle(item)}><Pencil size={13} /></button><button title="O‘chirish" onClick={() => deleteConversation(item)}><Trash2 size={13} /></button></span>
            </div>)}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-link" onClick={() => setDialog("templates")}><LayoutTemplate size={17} /><span>Shablonlar</span></button>
          <button className="sidebar-link" onClick={() => setDialog("stats")}><BarChart3 size={17} /><span>Statistika</span></button>
          <button className="sidebar-link" onClick={() => setDialog("help")}><CircleHelp size={17} /><span>Yordam markazi</span><ArrowRight size={14} /></button>
          <button className="sidebar-link" onClick={() => setDialog("settings")}><Settings2 size={17} /><span>Sozlamalar</span></button>
          <div className="account-row">
            <button className="account-card" onClick={() => { setProfile({ nickname: user.nickname || user.name || "", avatar: user.avatar || "" }); setDialog("profile"); }} title="Profilni ochish">
              <span className={`avatar ${user.avatar ? "avatar-image" : ""}`}>{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</span>
              <span className="account-info"><strong>{user.nickname || user.name}</strong><small>{user.email || user.phone || "Shaxsiy hisob"}</small></span><MoreHorizontal size={17} />
            </button>
            <button className="account-signout" type="button" title="Hisobdan chiqish" onClick={() => { if (window.confirm("Hisobdan chiqmoqchimisiz?")) signOut(); }}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileSidebar(true)} title="Menyu"><Menu size={19} /></button><div className="model-select"><span className="model-spark"><Sparkles size={15} /></span><span>Navo 2.5</span><span className="model-divider" /><span className="online-dot" /><span className="model-light">Fast</span><ChevronDown size={14} /></div></div>
          <div className="topbar-right">
            {searching
              ? <label className="topbar-search"><Search size={14} /><input ref={searchRef} value={messageQuery} onChange={(event) => setMessageQuery(event.target.value)} placeholder="Suhbat ichidan izlash..." /><span className="search-count">{messageQuery ? `${visibleMessages.length}/${messages.length}` : ""}</span><button type="button" title="Qidiruvni yopish" onClick={() => { setSearching(false); setMessageQuery(""); }}><X size={14} /></button></label>
              : <button className="icon-button" title="Suhbat ichidan izlash · Ctrl + F" onClick={() => { setSearching(true); window.setTimeout(() => searchRef.current?.focus(), 90); }}><Search size={17} /></button>}
            <div className="actions-menu">
              <button className="icon-button" title="Suhbat amallari" onClick={() => setActionsOpen((value) => !value)}><MoreHorizontal size={17} /></button>
              {actionsOpen && <div className="actions-popover">
                <button type="button" onClick={copyConversation}><Copy size={15} />Butun suhbatni nusxalash</button>
                <button type="button" onClick={() => exportConversation("md")}><FileDown size={15} />Markdown (.md) yuklab olish</button>
                <button type="button" onClick={() => exportConversation("txt")}><Download size={15} />Oddiy matn (.txt)</button>
                <button type="button" onClick={() => exportConversation("json")}><Download size={15} />JSON nusxa</button>
                <button type="button" onClick={printConversation}><Printer size={15} />Chop etish</button>
                <button type="button" onClick={() => setDialog("templates")}><LayoutTemplate size={15} />Shablonlar kutubxonasi</button>
              </div>}
            </div>
            <div className="secure-label"><ShieldCheck size={14} /><span>Shifrlangan sessiya</span></div><button className={`avatar top-avatar ${user.avatar ? "avatar-image" : ""}`} title="Profil sozlamalari" onClick={() => { setProfile({ nickname: user.nickname || user.name || "", avatar: user.avatar || "" }); setDialog("profile"); }}>{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</button></div>
        </header>
        <div className={`workspace ${welcome ? "workspace-welcome" : ""}`} ref={workspaceRef} onScroll={trackScroll} onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }} onDrop={handleDrop}>
          {welcome ? <section className="welcome">
            <div className="welcome-hero">
              <div className="welcome-intro">
                <div className="welcome-badge"><span className="online-dot" /> SHAXSIY AI YORDAMCHINGIZ</div>
                <h1>Salom, <span>{user.nickname || user.name?.split("@")[0] || "do‘stim"}.</span><br />Bugun nimani <span className="gradient-text">yaratamiz?</span></h1>
                <p className="welcome-description">G‘oyangizni yozing yoki fayl yuboring — reja tuzish, tahlil qilish va yangi narsalarni o‘rganishda yordam beraman.</p>
              </div>
              <WelcomeOrb />
            </div>
            <div className="suggestion-grid">{SUGGESTIONS.map(({ icon: Icon, label, prompt }) => {
              const expanded = expandedSuggestion === label;
              return <div className={`suggestion-item ${expanded ? "expanded" : ""}`} key={label}>
                <button className="suggestion-card glass-panel" type="button" onClick={() => { setDraft(prompt); composerRef.current?.focus(); }}>
                  <span className="suggestion-icon"><Icon size={18} /></span><span className="suggestion-label">{label}</span><span className="suggestion-copy">{prompt}</span>
                </button>
                <button className="suggestion-more" type="button" aria-expanded={expanded} onClick={() => setExpandedSuggestion(expanded ? null : label)}>
                  <span>{expanded ? "Kamroq" : "Ko‘proq"}</span><ArrowRight size={15} className="suggestion-arrow" />
                </button>
              </div>;
            })}</div>
            <div className="welcome-footnote"><Zap size={14} /> Ko‘p formatdagi fayllarni yuklang · Tezkor yordam oling</div>
          </section> : <section className="messages" aria-live="polite">
            {visibleMessages.map((message) => { const index = messages.indexOf(message); return <ChatMessage key={`${conversationId || "new"}-${index}`} message={message} index={index} query={messageQuery} copied={copiedId === index} speaking={speakingId === index} onCopy={() => copyMessage(message.content, index)} onRead={() => toggleReadAloud(message, index)} onEdit={() => editMessage(message)} onResend={() => resendMessage(message)} />; })}
            {messageQuery && visibleMessages.length === 0 && <div className="search-empty"><Search size={16} /><span>«{messageQuery}» bo‘yicha xabar topilmadi.</span></div>}
            {sending && <div className="message assistant-message"><span className="assistant-avatar"><Sparkles size={15} /></span><div className="message-body"><div className="thinking-indicator"><span /><span /><span /></div></div></div>}
            {chatError && <div className="error-banner"><Activity size={16} /><span>{chatError}</span><button onClick={() => setChatError("")}><X size={15} /></button></div>}
            <div ref={messagesEndRef} />
          </section>}
        </div>
        {dropActive && <div className="drop-overlay"><div className="drop-card"><Upload size={26} /><strong>Fayllarni shu yerga tashlang</strong><span>Ko‘pi bilan {MAX_FILES} ta fayl · har biri 12 MB gacha</span></div></div>}
        {showJump && <button className="jump-button" type="button" onClick={jumpToBottom}><ChevronDown size={16} /> Oxirgi xabarga o‘tish</button>}
        <div className="composer-zone"><form className="composer glass-panel" onSubmit={handleSend}>
          {files.length > 0 && <div className="attachment-list">{files.map((file, index) => { const Icon = fileIcon(file); return <div className="attachment-chip" key={`${file.name}-${file.size}`}><span className="file-icon"><Icon size={16} /></span><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><button type="button" title="Faylni olib tashlash" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X size={14} /></button></div>; })}</div>}
          <textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && settings.enterToSend) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} placeholder="Xabaringizni yozing..." aria-label="Xabar matni" />
          <div className="composer-actions"><div className="composer-tools"><input ref={fileInputRef} className="visually-hidden" type="file" multiple accept={ALLOWED_FILES} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} /><button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()} title="Fayl biriktirish"><Paperclip size={17} /></button><button className="tool-button" type="button" onClick={() => setDialog("formats")} title="Qo‘llab-quvvatlanadigan fayllar"><Upload size={16} /><span>Fayl yuklash</span></button><span className="tool-divider" /><button className={`tool-button voice-button ${voiceBusy ? "voice-active" : ""}`} type="button" onClick={toggleVoice} title={voiceBusy ? "Ovozli yozishni to‘xtatish" : "Ovoz bilan yozish"}>{voiceBusy ? <MicOff size={16} /> : <Mic size={16} />}<span>{voiceBusy ? "Eshityapman…" : "Ovoz"}</span></button><span className="format-hint">12 MB gacha · {MAX_FILES} ta fayl</span></div><button className="send-button" type="submit" disabled={sending || (!draft.trim() && files.length === 0)} title="Yuborish · Ctrl + Enter">{sending ? <span className="button-spinner" /> : <Send size={16} />}</button></div>
        </form><div className="composer-caption"><span><ShieldCheck size={13} /> Suhbatlaringiz akkauntingizda saqlanadi.</span><span className="usage-chip" title="Bugungi xabarlar soni"><Zap size={13} /> Bugun: {usage.used}{usage.limit ? `/${usage.limit}` : ""}</span>{draft.trim() ? <span className="char-count">{draft.trim().length} belgi</span> : null}<span>Javoblarni muhim qarorlardan oldin tekshiring.</span></div></div>
      </section>

      {dialog === "settings" && <SettingsDialog settings={settings} user={user} config={config} onChange={updateSetting} onClose={() => setDialog("")} onSignOut={signOut} onOpen={setDialog} onPrint={printConversation} />}
      {dialog === "profile" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><UserRound size={19} /></div><div><h2 id="profile-heading">Profil sozlamalari</h2><p>Hisobingizni o‘zingizga moslang.</p></div></div><form onSubmit={saveProfile}><label className="avatar-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => pickAvatar(event.target.files?.[0])} />      <span className={`avatar-preview ${profile.avatar ? "avatar-image" : ""}`}>{profile.avatar ? <img src={profile.avatar} alt="Avatar" /> : initials(profile.nickname || user.name)}</span><span className="avatar-edit"><ImagePlus size={15} /></span></label><p className="avatar-caption">Profil rasmi · PNG, JPEG, WebP · 500 KB gacha</p>{profile.avatar && <button type="button" className="remove-avatar" onClick={() => setProfile((current) => ({ ...current, avatar: "" }))}>Avatarni olib tashlash</button>}<label className="field-label">Ko‘rinadigan ism<input required minLength={2} maxLength={40} value={profile.nickname} onChange={(event) => setProfile((current) => ({ ...current, nickname: event.target.value }))} placeholder="Ismingiz" /></label><label className="field-label">Email yoki telefon<div className="readonly-field">{user.email || user.phone || "—"} <ShieldCheck size={14} /></div></label>{avatarError && <p className="inline-error">{avatarError}</p>}{profileMessage && <p className="inline-success">{profileMessage}</p>}<button className="primary-button modal-action" disabled={profileBusy}>{profileBusy ? <span className="button-spinner" /> : <Check size={16} />} Saqlash</button></form><div className="profile-stats">{stats ? <><div><strong>{stats.conversations}</strong><span>suhbat</span></div><div><strong>{stats.answers}</strong><span>javob</span></div><div><strong>{stats.used_today}{stats.daily_limit ? `/${stats.daily_limit}` : ""}</strong><span>bugun</span></div><div><strong>{stats.member_since ? new Date(stats.member_since * 1000).getFullYear() : "—"}</strong><span>a’zo bo‘lgan</span></div></> : <p className="profile-stats-loading">Statistika yuklanmoqda…</p>}</div><div className="profile-account-meta"><span>{user.verified ? <ShieldCheck size={14} /> : <CircleHelp size={14} />}{user.verified ? "Tasdiqlangan hisob" : "Tasdiqlanmagan hisob"}</span><span>{(user.email || user.phone || "—")}</span></div><button type="button" className="profile-signout" onClick={() => { if (window.confirm("Hisobdan chiqmoqchimisiz?")) { setDialog(""); signOut(); } }}><LogOut size={16} /> Hisobdan chiqish</button><p className="profile-signout-note">Chiqsangiz, qayta kirishingiz kerak bo‘ladi. Suhbatlaringiz akkauntingizda saqlanib qoladi.</p></section></div>}
      {dialog === "help" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><CircleHelp size={19} /></div><div><h2 id="help-heading">Yordam markazi</h2><p>Navo AI’dan samarali foydalanish.</p></div></div><div className="help-list"><div><span>01</span><p><strong>Yaxshi savol bering</strong><br />Maqsad va kerakli formatni yozsangiz, aniqroq javob olasiz.</p></div><div><span>02</span><p><strong>Fayl yoki bir nechta hujjat yuboring</strong><br />PDF, Office, OpenDocument, rasm va boshqa formatlarni tahlil qiling.</p></div><div><span>03</span><p><strong>Sozlamalarni moslang</strong><br />Mavzu, ixcham ko‘rinish, ovoz va Enter xatti-harakatini o‘zgartiring.</p></div></div><div className="shortcut-tip"><Command size={16} /><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> xabar yuboradi · <kbd>/</kbd> yozishni boshlaydi · <kbd>Esc</kbd> oynani yopadi</span></div></section></div>}
      {dialog === "formats" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card formats-dialog" role="dialog" aria-modal="true" aria-labelledby="formats-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><FileText size={19} /></div><div><h2 id="formats-heading">Fayl formatlari</h2><p>Bir xabarga 4 tagacha, har biri 12 MB gacha.</p></div></div><div className="format-grid">{Object.entries(FORMAT_LABELS).map(([ext, label]) => <div className="format-item" key={ext}><code>{ext}</code><span>{label}</span></div>)}</div><p className="format-footnote">Word, Excel, PowerPoint va PDF matni ajratib olinadi. Rasm, ovoz va videolar AI’ga yuboriladi. Eski DOC/XLS/PPT fayllarini DOCX/XLSX/PPTX qilib saqlang.</p></section></div>}
      {dialog === "templates" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card templates-dialog" role="dialog" aria-modal="true" aria-labelledby="templates-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><LayoutTemplate size={19} /></div><div><h2 id="templates-heading">Shablonlar</h2><p>Tayyor so‘rovni tanlang, kerak bo‘lsa tahrirlab yuboring.</p></div></div><div className="template-groups">{PROMPT_LIBRARY.map((group) => <div className="template-group" key={group.group}><h3>{group.group}</h3>{group.items.map((item) => <button type="button" className="template-item" key={item} onClick={() => useTemplate(item)}><Sparkles size={14} /><span>{item}</span><ArrowRight size={14} /></button>)}</div>)}</div></section></div>}
      {dialog === "stats" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(""); }}><section className="modal-card stats-dialog" role="dialog" aria-modal="true" aria-labelledby="stats-heading"><ModalClose onClick={() => setDialog("")} /><div className="modal-heading"><div className="modal-icon"><BarChart3 size={19} /></div><div><h2 id="stats-heading">Statistika</h2><p>Foydalanish bo‘yicha qisqa hisobot.</p></div></div>{stats ? <><div className="stat-grid"><div className="stat-card"><strong>{stats.conversations}</strong><span>Suhbatlar</span></div><div className="stat-card"><strong>{stats.messages}</strong><span>Xabarlar</span></div><div className="stat-card"><strong>{stats.answers}</strong><span>AI javoblari</span></div><div className="stat-card"><strong>{stats.used_today}{stats.daily_limit ? `/${stats.daily_limit}` : ""}</strong><span>Bugungi limit</span></div></div><div className="stat-chart"><h3>Oxirgi 7 kun</h3>{stats.recent_days.length === 0 ? <p className="stat-empty">Hali ma’lumot yo‘q. Birinchi savolingizni bering!</p> : <div className="stat-bars">{stats.recent_days.map((day) => <div className="stat-bar" key={day.day}><span style={{ height: `${Math.max(8, Math.round((day.messages / Math.max(...stats.recent_days.map((item) => item.messages), 1)) * 100))}%` }} /><em>{day.messages}</em><small>{day.day.slice(5)}</small></div>)}</div>}</div><div className="stat-meta"><span>{stats.verified ? <ShieldCheck size={14} /> : <CircleHelp size={14} />}{stats.verified ? "Tasdiqlangan hisob" : "Tasdiqlanmagan hisob"}</span><span><UserRound size={14} />A’zo bo‘lgan: {formatDate(stats.member_since)}{stats.member_since && relativeDay(stats.member_since) !== formatDate(stats.member_since) ? ` (${relativeDay(stats.member_since)})` : ""}</span></div></> : <p className="stat-empty">Statistika yuklanmoqda…</p>}</section></div>}
      {toast && <div className="toast-message"><CheckCheck size={16} />{toast}</div>}
    </main>
  );
}

function AuthScreen({ mode, stage, busy, error, notice, demoCode, form, onMode, onChange, onSubmit, onReset, onResend }) {
  const resetting = mode === "reset";
  const loginOtp = mode === "login" && stage === "login_otp";
  const verifying = stage === "code" || loginOtp;
  const [resendSeconds, setResendSeconds] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!verifying) {
      setResendSeconds(0);
      return undefined;
    }
    setResendSeconds(60);
    const timer = window.setInterval(() => {
      setResendSeconds((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verifying]);

  async function resendOtp() {
    if (busy || resendSeconds > 0) return;
    if (await onResend()) setResendSeconds(60);
  }

  const cooldownLabel = `${String(Math.floor(resendSeconds / 60)).padStart(2, "0")}:${String(resendSeconds % 60).padStart(2, "0")}`;
  return <main className="auth-layout"><div className="auth-glow auth-glow-one" /><div className="auth-glow auth-glow-two" />
    <section className="auth-presentation"><a className="brand auth-brand" href="/"><span className="brand-mark"><img alt="Navo AI" src={LOGO_SRC} /></span><span>Navo<span className="brand-accent">.ai</span></span></a><div className="auth-story"><div className="welcome-badge"><span className="online-dot" /> AI BILAN YANGICHA ISHLANG</div><h1>Fikringizga<br /><span className="gradient-text">aniqlik bering.</span></h1><p>G‘oyalaringizni rejalarga, savollaringizni esa tushunarli javoblarga aylantiring.</p><div className="auth-feature-list"><div><ShieldCheck size={17} /> Xavfsiz akkaunt va maxfiy suhbatlar</div><div><FileText size={17} /> Hujjatlar, rasmlar va ko‘p turdagi fayllar</div><div><AudioLines size={17} /> O‘zbek tilidagi qulay AI yordamchi</div></div></div><div className="auth-footer">Yaxshi g‘oya — yaxshi savoldan boshlanadi.</div></section>
    <section className={`auth-side ${verifying ? "auth-verifying" : ""}`}><div className="auth-card glass-panel" role={verifying ? "dialog" : undefined} aria-modal={verifying ? "true" : undefined} aria-labelledby="auth-heading"><div className="auth-card-logo"><span className="brand-mark"><img alt="Navo AI" src={LOGO_SRC} /></span><span>Navo AI</span><span className="auth-card-secure"><ShieldCheck size={13} /> Xavfsiz</span></div><h2 id="auth-heading">{verifying ? (resetting ? "Parolni tasdiqlang" : loginOtp ? "Kirishni tasdiqlang" : mode === "google" ? "Google hisobini tasdiqlang" : "Hisobingizni tasdiqlang") : resetting ? "Parolni tiklash" : mode === "login" ? "Xush kelibsiz" : "Yangi hisob yarating"}</h2><p className="auth-card-subtitle">{verifying ? `Kod ${form.identity} manziliga yuborildi.` : resetting ? "Yangi parol o‘rnatish uchun tasdiqlash kodini kiriting." : mode === "login" ? "Hisobingizga kirib davom eting." : "Shaxsiy AI yordamchingizni hoziroq ishga tushiring."}</p>
      {!verifying && !resetting && <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => onMode("login")}>Kirish</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => onMode("register")}>Ro‘yxatdan o‘tish</button></div>}
      <form className="auth-form" onSubmit={onSubmit}>
        {!verifying && <label className="field-label">Email yoki telefon<input required autoComplete="username" placeholder="ism@gmail.com yoki +998901234567" value={form.identity} onChange={(event) => onChange("identity", event.target.value)} /></label>}
        {(!verifying || resetting) && <label className="field-label">{resetting ? "Yangi parol" : "Parol"}<div className="password-field"><input required minLength={8} autoComplete={resetting ? "new-password" : mode === "register" ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} placeholder="Kamida 8 ta belgi" value={form.password} onChange={(event) => onChange("password", event.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"} title={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>}
        {mode === "register" && !verifying && <label className="field-label">Ism yoki nickname<input required minLength={2} maxLength={40} autoComplete="nickname" placeholder="Masalan, Dilshod" value={form.nickname} onChange={(event) => onChange("nickname", event.target.value)} /></label>}
        {verifying && <><label className="field-label">6 xonali tasdiqlash kodi<input required autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={form.code} onChange={(event) => onChange("code", event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>{demoCode && <div className="demo-code-note">Sinov rejimidagi kodingiz: <strong>{demoCode}</strong></div>}<button className="text-action" type="button" disabled={busy || resendSeconds > 0} onClick={resendOtp}>{resendSeconds > 0 ? `Kodni qayta yuborish · ${cooldownLabel}` : "Kodni qayta yuborish"}</button></>}
        {error && <p className="auth-feedback error-feedback" role="alert"><CircleHelp size={15} />{error}</p>}{notice && <p className="auth-feedback success-feedback"><Check size={15} />{notice}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? <span className="button-spinner" /> : <>{verifying ? <ShieldCheck size={17} /> : mode === "login" ? <LogIn size={17} /> : <ArrowRight size={17} />}{resetting ? "Parolni yangilash" : verifying ? (mode === "google" || loginOtp ? "Tasdiqlash va kirish" : "Tasdiqlash") : mode === "login" ? "Kirish" : "Hisob yaratish"}</>}</button>
      </form>
      {!verifying && !resetting && mode === "login" && <button className="text-action forgot-link" onClick={onReset}>Parolni unutdingizmi?</button>}
      {!verifying && !resetting && <><div className="auth-divider"><span>yoki</span></div><button className="google-auth" type="button" onClick={startGoogleLogin}><span className="google-mark">G</span> Google orqali davom etish</button></>}
      {resetting && <button className="text-action back-login" onClick={() => onMode("login")}><ArrowLeft size={14} /> Kirish sahifasiga qaytish</button>}
      <p className="auth-safety"><ShieldCheck size={13} /> Parolingiz himoyalangan holda saqlanadi.</p>
    </div><div className="auth-legal">Davom etib, foydalanish shartlariga rozilik bildirasiz.</div></section>
  </main>;
}

function ChatMessage({ message, copied, index, query, speaking, onCopy, onRead, onEdit, onResend }) {
  const assistant = message.role !== "user";
  return <article className={`message ${assistant ? "assistant-message" : "user-message"}`}>{assistant ? <span className="assistant-avatar"><Sparkles size={15} /></span> : <span className="user-message-avatar"><UserRound size={15} /></span>}<div className="message-body"><div className="message-label">{assistant ? "NAVO AI" : "SIZ"}{message.attachment && <span className="answer-attachment"><Paperclip size={12} />{message.attachment}</span>}</div><div className={`message-content ${assistant ? "markdown-content" : ""}`}>{assistant ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{message.content || ""}</ReactMarkdown> : <p>{highlightMatches(message.content, query)}</p>}</div>{message.files?.length > 0 && <div className="message-files">{message.files.map((file) => <span key={file}><FileText size={13} />{file}</span>)}</div>}
      <div className="message-actions">{assistant && <button className="copy-button" onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Nusxalandi" : "Javobni nusxalash"}</button>}
        {assistant && <button className={speaking ? "copy-button speaking" : "copy-button"} onClick={onRead}>{speaking ? <Square size={13} /> : <Volume2 size={13} />}{speaking ? "To‘xtatish" : "O‘qib berish"}</button>}
        {assistant && <button className="copy-button" onClick={onResend}><RefreshCw size={13} />Yana javob olish</button>}
        {!assistant && <button className="copy-button" onClick={onEdit}><Pencil size={13} />Tahrirlash</button>}
        {message.at ? <span className="message-time">{formatTime(message.at)}</span> : null}</div></div></article>;
}

function WelcomeOrb() {
  return <div className="welcome-visual" aria-hidden="true">
    <Suspense fallback={<div className="robot-3d-loading" />}>
      <Robot3D />
    </Suspense>
    <span className="robot-caption"><span className="online-dot" /> NAVO AI · ONLAYN</span>
  </div>;
}

function SettingsDialog({ settings, user, config, onChange, onClose, onSignOut, onOpen, onPrint }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-heading"><ModalClose onClick={onClose} /><div className="modal-heading"><div className="modal-icon"><Settings2 size={19} /></div><div><h2 id="settings-heading">Sozlamalar</h2><p>Navo AI’ni o‘zingizga moslang.</p></div></div>
    <div className="settings-group"><h3>Ko‘rinish</h3><SettingRow icon={settings.theme === "dark" ? Moon : Sun} title="Rang mavzusi" description="Ko‘zlaringizga qulay rejimni tanlang."><div className="segmented-control"><button className={settings.theme === "dark" ? "selected" : ""} onClick={() => onChange("theme", "dark")}><Moon size={14} /> Tungi</button><button className={settings.theme === "light" ? "selected" : ""} onClick={() => onChange("theme", "light")}><Sun size={14} /> Kunduzgi</button></div></SettingRow><SettingRow icon={PanelLeftClose} title="Ixcham ko‘rinish" description="Chat ro‘yxati va xabarlar orasidagi masofani qisqartiring."><Toggle value={settings.compact} onChange={(value) => onChange("compact", value)} label="Ixcham ko‘rinish" /></SettingRow></div>
    <div className="settings-group"><h3>Matn va o‘qish</h3><SettingRow icon={MonitorSmartphone} title="Matn o‘lchami" description="Suhbat matnlarini kattalashtiring."><div className="segmented-control">{FONT_SIZES.map((option) => <button key={option.id} className={(settings.font || "standart") === option.id ? "selected" : ""} onClick={() => onChange("font", option.id)}>{option.label}</button>)}</div></SettingRow><SettingRow icon={MonitorSmartphone} title="Tizim mavzusiga moslash" description="Qurilma tungi rejimga o‘tganda sayt ham o‘zgaradi."><Toggle value={settings.systemTheme} onChange={(value) => onChange("systemTheme", value)} label="Tizim mavzusi" /></SettingRow><SettingRow icon={Volume2} title="Javoblarni ovozli o‘qish" description="Yangi javob tayyor bo‘lganda avtomatik o‘qib beriladi."><Toggle value={settings.readAloud} onChange={(value) => onChange("readAloud", value)} label="Ovozli javob" /></SettingRow></div>
    <div className="settings-group"><h3>Tezkor amallar</h3><SettingRow icon={LayoutTemplate} title="Shablonlar" description="Tayyor so‘rovlar to‘plami."><button className="ghost-button" type="button" onClick={() => onOpen("templates")}>Ochish</button></SettingRow><SettingRow icon={BarChart3} title="Statistika" description="Suhbatlar va kunlik limit hisoboti."><button className="ghost-button" type="button" onClick={() => onOpen("stats")}>Ko‘rish</button></SettingRow><SettingRow icon={Printer} title="Suhbatni chop etish" description="Joriy suhbatni printer yoki PDF sifatida saqlash."><button className="ghost-button" type="button" onClick={onPrint}>Chop etish</button></SettingRow></div>
    <div className="settings-group"><h3>Yozish</h3><SettingRow icon={Command} title="Enter bilan yuborish" description="Yangi qator uchun Shift + Enter tugmalarini bosing."><Toggle value={settings.enterToSend} onChange={(value) => onChange("enterToSend", value)} label="Enter bilan yuborish" /></SettingRow><SettingRow icon={AudioLines} title="Javob ovozi" description="Javob tayyor bo‘lganda qisqa tovush eshittirish."><Toggle value={settings.sound} onChange={(value) => onChange("sound", value)} label="Javob ovozi" /></SettingRow></div>
    <div className="settings-group"><h3>Hisob va maxfiylik</h3><div className="settings-account"><span className={`avatar ${user.avatar ? "avatar-image" : ""}`}>{user.avatar ? <img src={user.avatar} alt="" /> : initials(user.nickname || user.name)}</span><span><strong>{user.nickname || user.name}</strong><small>{user.email || user.phone}</small></span><span className="verified-badge"><ShieldCheck size={13} /> himoyalangan</span></div><SettingRow icon={FileText} title="Suhbat tarixi" description="Shaxsiy suhbatlaringiz akkauntingizda saqlanadi." /><SettingRow icon={ShieldCheck} title="API ulanishi" description={config?.google_login ? "Google orqali kirish sozlangan." : "AI javoblari serverdagi Gemini kalitiga bog‘liq."} /><button className="sign-out-button" onClick={onSignOut}><LogOut size={16} /> Hisobdan chiqish</button></div><p className="settings-version">NAVO AI · WEB · 1.0</p>
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