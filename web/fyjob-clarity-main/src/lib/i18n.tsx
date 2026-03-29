import React, { createContext, useContext, useState, useEffect } from "react";

type Language = "en" | "id";

// Merged dictionary specifically designed for the massive dashboard rollout
const dictionary = {
  en: {
    // Nav & General
    nav_signin: "Sign In",
    nav_getstarted: "Get Started",
    hero_badge: "Enterprise Career Intelligence",
    hero_title: "The Ultimate Command Center for Your Career",
    hero_desc: "Stop applying blindly. Use our browser extension to analyze job posts instantly, and return to this web dashboard command center to build ATS-beating resumes, practice killer quizzes, and track your success probability across FAANG companies.",
    hero_cta: "Launch Dashboard",
    hero_github: "View GitHub",
    eco_title: "One Unfair Advantage. Two Ecosystems.",
    eco_desc: "FYJOB splits its architecture exactly where you need it.",
    eco_ext_title: "The Analyzer (Extension)",
    eco_ext_desc: "Lives in your browser. Extracts raw LinkedIn job descriptions, identifies hidden tech constraints, and sends deep-scan telemetry back to base.",
    eco_web_title: "The Command Center (Web)",
    eco_web_desc: "Your centralized terminal. Generate Harvard-tier ATS resumes, spar with the Ujang AI Recruiter, and launch mock technical quizzes.",
    tech_title: "Engineered for Extreme Performance",
    tech_desc: "Built on a bleeding-edge stack to guarantee zero lag and maximum ATS compliance.",
    feat_title: "Arsenal of Features",
    feat_desc: "Everything you need to secure that elite tech role.",
    feat_quick_title: "Quick Match",
    feat_quick_desc: "Instantly scrapes job descriptions and calculates match scores with missing keywords.",
    feat_ujang_title: "Ujang Persona",
    feat_ujang_desc: "Brutal, FAANG-level straight-talking career advice from our AI HR character.",
    feat_study_title: "Study Room",
    feat_study_desc: "AI-generated learning paths addressing your exact technical skill gaps.",
    feat_quiz_title: "Killer Quiz",
    feat_quiz_desc: "10 multiple-choice and 5 essay questions at FAANG-level difficulty to test your readiness.",
    feat_cv_title: "ATS CV Generator",
    feat_cv_desc: "God-tier resume builder guaranteed to parse correctly through enterprise applicant tracking systems.",
    
    // Auth
    auth_title_login: "Sign In to FYJOB",
    auth_title_register: "Create FYJOB Account",
    auth_email: "Email Address",
    auth_pass: "Password",
    auth_submit_login: "Access Terminal",
    auth_submit_register: "Initialize Account",
    auth_toggle_register: "Don't have an account?",
    auth_toggle_login: "Already have an account?",

    // Sidebar
    side_overview: "System Overview",
    side_cv: "CV Engine",
    side_history: "Application Telemetry",
    side_study: "Training Ground",
    side_quiz: "Killer Quiz Arena",
    side_settings: "Terminal Settings",
    side_logout: "Disconnect",

    // Dashboard Overview
    dash_welcome: "Welcome back",
    dash_active_cv: "Active CV Parameter",
    dash_metric_jobs: "Jobs Analyzed",
    dash_metric_score: "Global Match Score",
    dash_metric_quizzes: "Simulations Passed",
    dash_spotlight: "Active Job Spotlight",
    dash_skills: "Critical Skill Gaps",
    dash_recent: "Recent Applications",

    // CV Manager
    cv_title: "CV Engine",
    cv_desc: "Upload, analyze, or generate ATS-compliant CVs.",
    cv_tab_upload: "Parser & Analyzer",
    cv_tab_build: "ATS Builder",
    cv_active: "Active Profile",
    cv_upload_box: "Deploy New PDF",
    cv_replace: "Replace CV",
    cv_extracted: "Extracted Telemetry",

    // Ujang Chat
    ujang_intro: "Look, I'm Ujang, extreme FAANG ex-Recruiter. I'm scanning your Senior Backend Engineer metrics... and it's barely scraping an 87%. Are you actually applying to GoTo with this weak data?",
    ujang_sim: "Interview Sim",
    ujang_fix: "Fix Summary",
    ujang_quiz_q: "Why did I fail?",
    ujang_placeholder: "Consult Ujang...",

    // Settings
    set_title: "Terminal Settings",
    set_desc: "Manage structural preferences and global security.",
    set_tab_prof: "Identity",
    set_tab_app: "Display",
    set_tab_notif: "Alerts",
    set_tab_sec: "Encryption",

    // Killer Quiz
    quiz_gate_title: "Select Target Parameter",
    quiz_gate_desc: "A target profile must be locked before generating simulation arrays.",
    quiz_return: "Abort & Return",
    quiz_prev: "Previous Vector",
    quiz_next: "Next Vector",
    quiz_submit: "Execute Submission",
    
    // General
    status_applied: "Deployed",
    status_pending: "Awaiting Action",
    status_study: "Training Required"
  },
  id: {
    // Nav & General
    nav_signin: "Masuk",
    nav_getstarted: "Mulai Sekarang",
    hero_badge: "Kecerdasan Karir Enterprise",
    hero_title: "Pusat Komando Utama untuk Karir Anda",
    hero_desc: "Berhenti melamar pekerjaan secara buta. Gunakan ekstensi browser kami untuk menganalisis loker seketika, dan kembali ke Web Dasbor (pusat komando) ini untuk merakit CV kebal ATS, berlatih kuis maut, dan melacak probabilitas lolos ke FAANG.",
    hero_cta: "Buka Dasbor",
    hero_github: "Lihat GitHub",
    eco_title: "Satu Keuntungan Mustahil. Dua Ekosistem.",
    eco_desc: "FYJOB memisahkan arsitekturnya tepat di tempat Anda membutuhkannya.",
    eco_ext_title: "Sang Penilai (Extension)",
    eco_ext_desc: "Hidup di browser Anda. Mengekstrak data kotor loker LinkedIn, mengidentifikasi syarat tersembunyi, dan mengirimkan telemetri ke pusat.",
    eco_web_title: "Pusat Komando (Web App)",
    eco_web_desc: "Terminal sentral Anda. Di sinilah CV tingkat dewa dicetak, obrolan simulasi dengan Ujang HR AI berjalan, dan latihan algoritma dieksekusi.",
    tech_title: "Direkayasa untuk Performa Ekstrem",
    tech_desc: "Dibangun di atas teknologi mutakhir untuk menjamin nihil lag dan akurasi skor ATS maksimal.",
    feat_title: "Gudang Persenjataan Karir",
    feat_desc: "Semua fitur yang Anda butuhkan untuk merebut posisi tech elit.",
    feat_quick_title: "Sistem Quick Match",
    feat_quick_desc: "Mengekstrak deskripsi pekerjaan seketika dan menghitung skor kecocokan CV beserta kata kunci yang hilang.",
    feat_ujang_title: "Persona Ujang HR",
    feat_ujang_desc: "Karakter AI berwatak galak dan blak-blakan yang menjatuhkan pedasnya fakta demi kebaikan karir Anda.",
    feat_study_title: "Ruang Belajar AI",
    feat_study_desc: "Jalur pembelajaran spesifik yang dihasilkan AI untuk menutup celah kelemahan teknis Anda.",
    feat_quiz_title: "Killer Quiz",
    feat_quiz_desc: "Simulasi sadis berisi soal pilihan ganda dan esai tingkat FAANG untuk menguji kesiapan mental Anda.",
    feat_cv_title: "Generator CV ATS",
    feat_cv_desc: "Mesin pencetak CV tingkat dewa yang dijamin terdeteksi sempurna oleh sistem ATS perusahaan korporat.",
    
    // Auth
    auth_title_login: "Masuk Web Dasbor",
    auth_title_register: "Inisialisasi Akses",
    auth_email: "Alamat Email",
    auth_pass: "Kata Sandi",
    auth_submit_login: "Akses Terminal",
    auth_submit_register: "Bangun Akun",
    auth_toggle_register: "Belum punya akses?",
    auth_toggle_login: "Sudah terdaftar?",

    // Sidebar
    side_overview: "Tinjauan Sistem",
    side_cv: "Mesin CV",
    side_history: "Telemetri Lamaran",
    side_study: "Ruang Latihan",
    side_quiz: "Arena Kuis Maut",
    side_settings: "Preferensi Terminal",
    side_logout: "Putus Koneksi",

    // Dashboard Overview
    dash_welcome: "Selamat datang kembali",
    dash_active_cv: "Parameter CV Aktif",
    dash_metric_jobs: "Pekerjaan Dianalisis",
    dash_metric_score: "Skor Kecocokan Global",
    dash_metric_quizzes: "Simulasi Lulus",
    dash_spotlight: "Fokus Loker Tersedia",
    dash_skills: "Kesenjangan Inti (Skill)",
    dash_recent: "Transmisi Lamaran Terbaru",

    // CV Manager
    cv_title: "Mesin CV ATS",
    cv_desc: "Unggah, analisa, atau rakit CV baru berkekuatan tembus ATS.",
    cv_tab_upload: "Analisis Manual",
    cv_tab_build: "Generator Dewa",
    cv_active: "Profil Aktif Anda",
    cv_upload_box: "Sebar PDF Baru",
    cv_replace: "Ganti CV Utama",
    cv_extracted: "Ekstraksi Teks Mentah",

    // Ujang Chat
    ujang_intro: "Halo. Ingat, saya Ujang—mantan HR FAANG. Saya barusan ngecek matriks CV 'Senior Backend Engineer' kamu dan skornya mandek di 87%. Seriusan lamar GoTo pakai modal nekat beginian?",
    ujang_sim: "Simulasi Wawancara",
    ujang_fix: "Revisi Summary",
    ujang_quiz_q: "Kenapa kuis saya gagal?",
    ujang_placeholder: "Ketik pembelaanmu di sini...",

    // Settings
    set_title: "Preferensi Terminal",
    set_desc: "Kelola setelan tampilan struktural dan kemananan global.",
    set_tab_prof: "Identitas Diri",
    set_tab_app: "Tampilan Layar",
    set_tab_notif: "Alarm Notifikasi",
    set_tab_sec: "Enkripsi Keamanan",

    // Killer Quiz
    quiz_gate_title: "Kunci Parameter Loker",
    quiz_gate_desc: "Pilih target lowongan yang sudah dianalisis agar soal kuis tersusup dengan akurat.",
    quiz_return: "Batal & Mundur",
    quiz_prev: "Vektor Mundur",
    quiz_next: "Vektor Maju",
    quiz_submit: "Eksekusi Jawaban",
    
    // General
    status_applied: "Berkas Terkirim",
    status_pending: "Menunggu Tindakan",
    status_study: "Wajib Latihan"
  }
};

type DictionaryKey = keyof typeof dictionary.en;

interface TranslationContextType {
  language: Language;
  toggleLanguage: () => void;
  t: (key: DictionaryKey) => string;
}

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export const TranslationProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    const saved = localStorage.getItem("fyjob_lang") as Language;
    if (saved && (saved === "en" || saved === "id")) {
      setLanguage(saved);
    }
  }, []);

  const toggleLanguage = () => {
    const newLang = language === "en" ? "id" : "en";
    setLanguage(newLang);
    localStorage.setItem("fyjob_lang", newLang);
  };

  const t = (key: DictionaryKey | string): string => {
    // Basic fallback if key implies strict DictionaryKey typing is bypassed
    const validKey = key as DictionaryKey;
    return dictionary[language]?.[validKey] || validKey;
  };

  return (
    <TranslationContext.Provider value={{ language, toggleLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) throw new Error("useTranslation must be used within TranslationProvider");
  return context;
};
