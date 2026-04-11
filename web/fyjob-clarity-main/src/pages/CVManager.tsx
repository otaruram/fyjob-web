import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText,
  Upload,
  CheckCircle2,
  Clock,
  RefreshCw,
  Trash2,
  LayoutTemplate,
  PenTool,
  Download,
  AlertCircle,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  GripVertical,
  Eye,
  FileText as FileTextIcon,
  Copy,
  Share2,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { uploadCV, uploadCVPdf, getCVPreview, deleteCV, CVPreview as CVPreviewType } from "@/lib/api";


const anim = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
});

const templates = [
  { id: "harvard", name: "Minimalist Elite", desc: "Harvard Standard. Zero distraction. High density. Best for FAANG backend/systems roles.", icon: FileText },
  { id: "tech", name: "Tech-Focused FAANG", desc: "Highlights Tech Stack & GitHub early. Best for frontend and full-stack engineers.", icon: LayoutTemplate },
  { id: "exec", name: "Executive Strategy", desc: "Stanford/Wharton format. Focuses heavily on Business Impact and OKR metrics.", icon: PenTool }
];

type ExperienceEntry = {
  company: string;
  role: string;
  location: string;
  start: string;
  end: string;
  bullets: string;
};

type EducationEntry = {
  school: string;
  degree: string;
  location: string;
  year: string;
  details: string;
};

type BuilderForm = {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  summary: string;
  experiences: ExperienceEntry[];
  education: EducationEntry[];
  skills: string;
  certifications: string;
};

type BuilderSectionKey = "summary" | "experience" | "education" | "skills" | "certifications";

const defaultSectionOrder: BuilderSectionKey[] = [
  "summary",
  "experience",
  "education",
  "skills",
  "certifications",
];

const sectionLabels: Record<BuilderSectionKey, string> = {
  summary: "Professional Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  certifications: "Certifications",
};

const BUILDER_DRAFT_KEY = "fyjob_cv_builder_draft_v1";

const createEmptyExperience = (): ExperienceEntry => ({
  company: "",
  role: "",
  location: "",
  start: "",
  end: "",
  bullets: "",
});

const createEmptyEducation = (): EducationEntry => ({
  school: "",
  degree: "",
  location: "",
  year: "",
  details: "",
});

const initialBuilderForm: BuilderForm = {
  fullName: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  portfolio: "",
  summary: "",
  experiences: [createEmptyExperience()],
  education: [createEmptyEducation()],
  skills: "",
  certifications: "",
};

const builderSteps = [
  "Profile",
  "Summary",
  "Experience",
  "Education",
  "Skills",
  "Review",
];

const splitBullets = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean);

const splitList = (text: string): string[] =>
  text
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const buildCVText = (form: BuilderForm, sectionOrder: BuilderSectionKey[]): string => {
  const blocks: string[] = [];

  blocks.push(form.fullName.toUpperCase());

  const contactBits = [form.headline, form.email, form.phone, form.location, form.linkedin, form.portfolio]
    .filter(Boolean)
    .join(" | ");
  if (contactBits) blocks.push(contactBits);

  const validExperiences = form.experiences.filter((exp) => exp.company || exp.role || exp.bullets);
  const validEducation = form.education.filter((edu) => edu.school || edu.degree);
  const skills = splitList(form.skills);
  const certifications = splitList(form.certifications);

  sectionOrder.forEach((section) => {
    if (section === "summary" && form.summary.trim()) {
      blocks.push("\nPROFESSIONAL SUMMARY");
      blocks.push(form.summary.trim());
    }

    if (section === "experience" && validExperiences.length > 0) {
      blocks.push("\nEXPERIENCE");
      validExperiences.forEach((exp) => {
        const metaLine = [exp.role, exp.company].filter(Boolean).join(" - ");
        const dateLocLine = [[exp.start, exp.end].filter(Boolean).join(" - "), exp.location]
          .filter(Boolean)
          .join(" | ");

        if (metaLine) blocks.push(metaLine);
        if (dateLocLine) blocks.push(dateLocLine);

        const bullets = splitBullets(exp.bullets);
        bullets.forEach((bullet) => blocks.push(`- ${bullet}`));
        blocks.push("");
      });
    }

    if (section === "education" && validEducation.length > 0) {
      blocks.push("\nEDUCATION");
      validEducation.forEach((edu) => {
        const line = [edu.degree, edu.school].filter(Boolean).join(" - ");
        const meta = [edu.year, edu.location].filter(Boolean).join(" | ");
        if (line) blocks.push(line);
        if (meta) blocks.push(meta);
        if (edu.details.trim()) blocks.push(edu.details.trim());
        blocks.push("");
      });
    }

    if (section === "skills" && skills.length > 0) {
      blocks.push("\nSKILLS");
      blocks.push(skills.join(" | "));
    }

    if (section === "certifications" && certifications.length > 0) {
      blocks.push("\nCERTIFICATIONS");
      certifications.forEach((cert) => blocks.push(`- ${cert}`));
    }
  });

  return blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const isHeadingLike = (line: string): boolean => {
  const value = line.trim();
  if (!value) return false;
  const short = value.length <= 40;
  const uppercase = value === value.toUpperCase() && /[A-Z]/.test(value);
  return value.endsWith(":") || (short && uppercase);
};

const getATSInsights = (form: BuilderForm) => {
  const skillsCount = splitList(form.skills).length;
  const experiences = form.experiences.filter((exp) => exp.company || exp.role || exp.bullets);
  const bullets = experiences.flatMap((exp) => splitBullets(exp.bullets));
  const bulletsWithMetrics = bullets.filter((line) => /(\d+%|\d+x|\$\d+|\d+\+)/.test(line)).length;
  const hasContact = Boolean(form.fullName && form.email && form.phone && form.location);
  const summaryLength = form.summary.trim().length;

  const checks = [
    { label: "Contact lengkap (nama, email, phone, lokasi)", pass: hasContact },
    { label: "Ringkasan 60-320 karakter", pass: summaryLength >= 60 && summaryLength <= 320 },
    { label: "Minimal 2 pengalaman kerja", pass: experiences.length >= 2 },
    { label: "Minimal 8 skills ATS keywords", pass: skillsCount >= 8 },
    { label: "Ada impact metrics di bullet points", pass: bulletsWithMetrics >= 2 },
  ];

  const score = checks.reduce((acc, check) => acc + (check.pass ? 20 : 0), 0);
  return { score, checks };
};

const getBuilderFilename = (name: string) => {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return clean ? `ats-builder-${clean}.txt` : "ats-builder-cv.txt";
};

const getTemplateCSS = (template: string): string => {
  const baseCSS = `
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 780px; margin: 0 auto; padding: 40px 20px; }
    h1 { margin: 0 0 5px 0; font-size: 24px; font-weight: bold; }
    h2 { margin: 15px 0 8px 0; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 3px; }
    h3 { margin: 8px 0 2px 0; font-size: 11px; font-weight: bold; }
    p { margin: 3px 0; font-size: 10px; }
    .contact { font-size: 9px; margin: 3px 0; }
    .bullet { margin-left: 15px; font-size: 10px; }
    .summary { font-size: 10px; line-height: 1.4; margin: 5px 0; }
    @media print { body { padding: 20px; } }
  `;
  
  if (template === "tech") {
    return baseCSS + `
      body { font-family: 'Courier New', monospace; }
      h1 { font-family: Arial, sans-serif; }
      .skill-item { display: inline-block; margin-right: 8px; padding: 2px 5px; background-color: #f0f0f0; border-radius: 3px; font-size: 9px; }
    `;
  }
  
  if (template === "exec") {
    return baseCSS + `
      body { font-family: 'Georgia', serif; }
      h1 { font-family: 'Georgia', serif; }
    `;
  }
  
  return baseCSS;
};

const generateHTMLPreview = (text: string, template: string): string => {
  const lines = text.split("\n");
  const html = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<p></p>";
      if (isHeadingLike(trimmed)) {
        return `<h2>${trimmed.replace(/:$/, "")}</h2>`;
      }
      if (trimmed.startsWith("-")) {
        return `<div class="bullet">•&nbsp;${trimmed.replace(/^[-*•\s]+/, "").trim()}</div>`;
      }
      if (line.length > 0 && !line.startsWith(" ")) {
        return `<h3>${trimmed}</h3>`;
      }
      return `<p class="summary">${trimmed}</p>`;
    })
    .join("\n");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>CV</title>
  <style>${getTemplateCSS(template)}</style>
</head>
<body>
  ${html}
</body>
</html>
  `;
};

const CVManager = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("upload");
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0].id);
  const [cvData, setCvData] = useState<CVPreviewType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [builderStep, setBuilderStep] = useState(0);
  const [builderForm, setBuilderForm] = useState<BuilderForm>(initialBuilderForm);
  const [sectionOrder, setSectionOrder] = useState<BuilderSectionKey[]>(defaultSectionOrder);
  const [isPublishingBuilder, setIsPublishingBuilder] = useState(false);
  const [builderMessage, setBuilderMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [dragExpIndex, setDragExpIndex] = useState<number | null>(null);
  const [dragEduIndex, setDragEduIndex] = useState<number | null>(null);
  const [dragSectionIndex, setDragSectionIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const builderText = buildCVText(builderForm, sectionOrder);
  const atsInsights = getATSInsights(builderForm);

  const updateBuilderField = <K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) => {
    setBuilderForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateExperience = (index: number, key: keyof ExperienceEntry, value: string) => {
    setBuilderForm((prev) => ({
      ...prev,
      experiences: prev.experiences.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  };

  const updateEducation = (index: number, key: keyof EducationEntry, value: string) => {
    setBuilderForm((prev) => ({
      ...prev,
      education: prev.education.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  };

  const addExperience = () => {
    setBuilderForm((prev) => ({ ...prev, experiences: [...prev.experiences, createEmptyExperience()] }));
  };

  const removeExperience = (index: number) => {
    setBuilderForm((prev) => ({
      ...prev,
      experiences: prev.experiences.length > 1 ? prev.experiences.filter((_, i) => i !== index) : prev.experiences,
    }));
  };

  const addEducation = () => {
    setBuilderForm((prev) => ({ ...prev, education: [...prev.education, createEmptyEducation()] }));
  };

  const removeEducation = (index: number) => {
    setBuilderForm((prev) => ({
      ...prev,
      education: prev.education.length > 1 ? prev.education.filter((_, i) => i !== index) : prev.education,
    }));
  };

  const moveExperience = (from: number, to: number) => {
    if (from === to) return;
    setBuilderForm((prev) => {
      const next = [...prev.experiences];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, experiences: next };
    });
  };

  const moveEducation = (from: number, to: number) => {
    if (from === to) return;
    setBuilderForm((prev) => {
      const next = [...prev.education];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, education: next };
    });
  };

  const moveSection = (from: number, to: number) => {
    if (from === to) return;
    setSectionOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // Load CV Preview — with sessionStorage cache to avoid redundant API calls
  const CV_CACHE_KEY = "fyjob_cv_cache";
  
  const fetchCV = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      
      // Check sessionStorage cache first
      try {
        const cached = sessionStorage.getItem(CV_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          // Cache valid for 5 minutes
          if (parsed._ts && Date.now() - parsed._ts < 5 * 60 * 1000) {
            setCvData(parsed.has_cv ? parsed : null);
            setIsLoading(false);
            return;
          }
        }
      } catch {}
      
      const data = await getCVPreview();
      
      // Cache the response
      try {
        sessionStorage.setItem(CV_CACHE_KEY, JSON.stringify({ ...data, _ts: Date.now() }));
      } catch {}
      
      setCvData(data.has_cv ? data : null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to load CV preview");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCV();
  }, [fetchCV]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(BUILDER_DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        builderForm?: BuilderForm;
        selectedTemplate?: string;
        sectionOrder?: BuilderSectionKey[];
      };

      if (parsed.builderForm) setBuilderForm(parsed.builderForm);
      if (parsed.selectedTemplate) setSelectedTemplate(parsed.selectedTemplate);
      if (parsed.sectionOrder && parsed.sectionOrder.length === defaultSectionOrder.length) {
        setSectionOrder(parsed.sectionOrder);
      }
    } catch {
      // ignore invalid local draft
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        BUILDER_DRAFT_KEY,
        JSON.stringify({
          builderForm,
          selectedTemplate,
          sectionOrder,
        }),
      );
    } catch {
      // ignore storage issues
    }
  }, [builderForm, selectedTemplate, sectionOrder]);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (data:application/pdf;base64,)
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle File Upload — now sends PDF binary to backend for PNG conversion
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setErrorMsg("Please upload a valid PDF file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("File is too large. Max size is 10MB.");
      return;
    }

    try {
      setIsUploading(true);
      setErrorMsg(null);
      
      const pdfBase64 = await fileToBase64(file);
      await uploadCVPdf(pdfBase64, file.name);
      
      // Clear sessionStorage cache so new data is fetched
      try { sessionStorage.removeItem("fyjob_cv_cache"); } catch {}
      
      await fetchCV(); // Refresh preview
      
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process and upload CV.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete your active CV? Quick Match will not work until you upload a new one.")) return;
    
    try {
      setIsLoading(true);
      await deleteCV();
      setCvData(null);
      // Clear cache
      try { sessionStorage.removeItem("fyjob_cv_cache"); } catch {}
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete CV");
      setIsLoading(false);
    }
  };

  const downloadBuilder = () => {
    const blob = new Blob([builderText || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getBuilderFilename(builderForm.fullName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadBuilderHTML = () => {
    const html = generateHTMLPreview(builderText, selectedTemplate);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getBuilderFilename(builderForm.fullName).replace(".txt", ".html");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const openPrintPreview = () => {
    const html = generateHTMLPreview(builderText, selectedTemplate);
    const printWindow = window.open("", "", "height=600,width=800");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  const copyBuilderText = () => {
    navigator.clipboard.writeText(builderText).then(() => {
      setBuilderMessage("CV text sudah dicopy ke clipboard");
      setTimeout(() => setBuilderMessage(null), 3000);
    });
  };

  const publishBuilderToActiveCV = async () => {
    if (!builderText.trim()) {
      setErrorMsg("CV Builder masih kosong. Isi minimal profile dan pengalaman.");
      return;
    }

    try {
      setIsPublishingBuilder(true);
      setBuilderMessage(null);
      setErrorMsg(null);
      await uploadCV(builderText, getBuilderFilename(builderForm.fullName));
      await fetchCV();
      setBuilderMessage("ATS Builder berhasil dipublish dan sekarang jadi Active CV.");
      setActiveTab("upload");
    } catch (err: any) {
      setErrorMsg(err.message || "Gagal publish ATS Builder ke Active CV.");
    } finally {
      setIsPublishingBuilder(false);
    }
  };

  const resetBuilderDraft = () => {
    setBuilderForm(initialBuilderForm);
    setSelectedTemplate(templates[0].id);
    setSectionOrder(defaultSectionOrder);
    setBuilderStep(0);
    setBuilderMessage(null);
    setErrorMsg(null);
    try {
      localStorage.removeItem(BUILDER_DRAFT_KEY);
    } catch {
      // ignore storage issues
    }
  };

  const renderBuilderStep = () => {
    if (builderStep === 0) {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input placeholder="Full Name" value={builderForm.fullName} onChange={(e) => updateBuilderField("fullName", e.target.value)} />
            <Input placeholder="Headline (ex: Senior Frontend Engineer)" value={builderForm.headline} onChange={(e) => updateBuilderField("headline", e.target.value)} />
            <Input placeholder="Email" value={builderForm.email} onChange={(e) => updateBuilderField("email", e.target.value)} />
            <Input placeholder="Phone" value={builderForm.phone} onChange={(e) => updateBuilderField("phone", e.target.value)} />
            <Input placeholder="Location" value={builderForm.location} onChange={(e) => updateBuilderField("location", e.target.value)} />
            <Input placeholder="LinkedIn URL" value={builderForm.linkedin} onChange={(e) => updateBuilderField("linkedin", e.target.value)} />
          </div>
          <Input placeholder="Portfolio / GitHub URL" value={builderForm.portfolio} onChange={(e) => updateBuilderField("portfolio", e.target.value)} />
        </div>
      );
    }

    if (builderStep === 1) {
      return (
        <div className="space-y-3">
          <Textarea
            placeholder="Write a concise ATS-friendly summary with role focus, years of experience, and domain strengths."
            className="min-h-[180px]"
            value={builderForm.summary}
            onChange={(e) => updateBuilderField("summary", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Target 60-320 chars. Mention stack, business impact, and type of role you are targeting.
          </p>
        </div>
      );
    }

    if (builderStep === 2) {
      return (
        <div className="space-y-4">
          {builderForm.experiences.map((exp, index) => (
            <div
              key={`exp-${index}`}
              className={`border rounded-lg p-4 space-y-3 bg-background/40 transition-colors ${dragExpIndex === index ? "border-primary/60" : "border-border"}`}
              draggable
              onDragStart={() => setDragExpIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragExpIndex !== null) moveExperience(dragExpIndex, index);
                setDragExpIndex(null);
              }}
              onDragEnd={() => setDragExpIndex(null)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <h4 className="text-sm font-semibold">Experience #{index + 1}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeExperience(index)} disabled={builderForm.experiences.length === 1}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Role" value={exp.role} onChange={(e) => updateExperience(index, "role", e.target.value)} />
                <Input placeholder="Company" value={exp.company} onChange={(e) => updateExperience(index, "company", e.target.value)} />
                <Input placeholder="Start (ex: Jan 2022)" value={exp.start} onChange={(e) => updateExperience(index, "start", e.target.value)} />
                <Input placeholder="End (ex: Present)" value={exp.end} onChange={(e) => updateExperience(index, "end", e.target.value)} />
                <Input placeholder="Location" className="md:col-span-2" value={exp.location} onChange={(e) => updateExperience(index, "location", e.target.value)} />
              </div>
              <Textarea
                placeholder={"Bullets (1 line each)\n- Built feature X that increased conversion +28%\n- Reduced API latency from 800ms to 300ms"}
                className="min-h-[130px]"
                value={exp.bullets}
                onChange={(e) => updateExperience(index, "bullets", e.target.value)}
              />
            </div>
          ))}
          <Button variant="outline" className="w-full" onClick={addExperience}>
            <Plus className="w-4 h-4 mr-2" /> Add Experience
          </Button>
          <p className="text-xs text-muted-foreground">Drag kartu experience untuk mengubah urutan tampil di CV.</p>
        </div>
      );
    }

    if (builderStep === 3) {
      return (
        <div className="space-y-4">
          {builderForm.education.map((edu, index) => (
            <div
              key={`edu-${index}`}
              className={`border rounded-lg p-4 space-y-3 bg-background/40 transition-colors ${dragEduIndex === index ? "border-primary/60" : "border-border"}`}
              draggable
              onDragStart={() => setDragEduIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragEduIndex !== null) moveEducation(dragEduIndex, index);
                setDragEduIndex(null);
              }}
              onDragEnd={() => setDragEduIndex(null)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <h4 className="text-sm font-semibold">Education #{index + 1}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeEducation(index)} disabled={builderForm.education.length === 1}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Degree" value={edu.degree} onChange={(e) => updateEducation(index, "degree", e.target.value)} />
                <Input placeholder="School / University" value={edu.school} onChange={(e) => updateEducation(index, "school", e.target.value)} />
                <Input placeholder="Year" value={edu.year} onChange={(e) => updateEducation(index, "year", e.target.value)} />
                <Input placeholder="Location" value={edu.location} onChange={(e) => updateEducation(index, "location", e.target.value)} />
              </div>
              <Textarea
                placeholder="Optional details (GPA, relevant coursework, achievements)"
                value={edu.details}
                onChange={(e) => updateEducation(index, "details", e.target.value)}
              />
            </div>
          ))}
          <Button variant="outline" className="w-full" onClick={addEducation}>
            <Plus className="w-4 h-4 mr-2" /> Add Education
          </Button>
          <p className="text-xs text-muted-foreground">Drag kartu education untuk mengubah urutan tampil di CV.</p>
        </div>
      );
    }

    if (builderStep === 4) {
      return (
        <div className="space-y-4">
          <Textarea
            placeholder="Skills (comma/new line separated): React, TypeScript, Node.js, PostgreSQL, CI/CD, AWS, ..."
            className="min-h-[140px]"
            value={builderForm.skills}
            onChange={(e) => updateBuilderField("skills", e.target.value)}
          />
          <Textarea
            placeholder="Certifications (optional, one per line)"
            className="min-h-[120px]"
            value={builderForm.certifications}
            onChange={(e) => updateBuilderField("certifications", e.target.value)}
          />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">ATS Readiness Score</p>
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
              {atsInsights.score}/100
            </Badge>
          </div>
          <div className="w-full h-2 rounded-full bg-muted mt-3 overflow-hidden">
            <div className="h-full bg-success transition-all" style={{ width: `${atsInsights.score}%` }} />
          </div>
          <div className="mt-3 space-y-2">
            {atsInsights.checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 text-xs">
                <CheckCircle2 className={`w-3.5 h-3.5 ${check.pass ? "text-success" : "text-muted-foreground/40"}`} />
                <span className={check.pass ? "text-foreground" : "text-muted-foreground"}>{check.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadBuilder}>
            <Download className="w-4 h-4 mr-2" /> Download TXT
          </Button>
          <Button variant="outline" onClick={downloadBuilderHTML}>
            <FileTextIcon className="w-4 h-4 mr-2" /> Download HTML
          </Button>
          <Button variant="outline" onClick={openPrintPreview}>
            <Eye className="w-4 h-4 mr-2" /> Print Preview
          </Button>
          <Button variant="outline" onClick={copyBuilderText}>
            <Copy className="w-4 h-4 mr-2" /> Copy Text
          </Button>
          <Button variant="hero" onClick={publishBuilderToActiveCV} disabled={isPublishingBuilder}>
            {isPublishingBuilder ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Publish as Active CV
          </Button>
        </div>

        {builderMessage && (
          <div className="rounded-lg border border-success/30 bg-success/10 text-success text-sm px-4 py-3">
            {builderMessage}
          </div>
        )}
      </div>
    );
  };

  return (
  <DashboardLayout>
    <div className="max-w-7xl mx-auto space-y-6">
      <motion.div {...anim(0)} className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('cv_title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('cv_desc')}
          </p>
        </div>
        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-2 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {errorMsg}
          </div>
        )}
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-1 max-w-md bg-card border border-border">
          <TabsTrigger value="upload">{t('cv_tab_upload')}</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-6 space-y-6">
          {/* Top Row */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            
            {/* Active CV Status */}
            <motion.div {...anim(0.1)} className="lg:col-span-2 glass rounded-xl p-6 gradient-border flex flex-col items-start h-full">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                {t('cv_active')}
              </h2>
              
              {isLoading && !cvData ? (
                <div className="flex-1 w-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : cvData ? (
                <div className="w-full border p-4 rounded-xl border-border bg-background/50 relative overflow-hidden group">
                  {/* Decorative corner */}
                  <div className="absolute -top-10 -right-10 w-24 h-24 bg-success/10 rounded-full blur-xl group-hover:bg-success/20 transition-colors pointer-events-none" />
                  
                  <div className="flex items-start gap-4 relative z-10">
                    <div className="h-14 w-14 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center shrink-0">
                      <FileText className="h-7 w-7 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{cvData.filename}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Uploaded {new Date(cvData.uploaded_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success text-xs shadow-sm">
                          Ready for Quick Match
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 pt-4 border-t border-border flex gap-2">
                    <Button variant="destructive" size="sm" className="w-full bg-destructive/10 text-destructive hover:bg-destructive hover:text-white border-destructive/20" onClick={handleDelete}>
                      <Trash2 className="w-4 h-4 mr-2" /> Delete CV
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 w-full border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center text-center p-6 bg-background/30">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No CV Uploaded</p>
                  <p className="text-xs text-muted-foreground mt-1 px-4">Upload PDF CV dulu. Semua fitur analisis akan ditolak kalau CV belum ada.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => window.open("https://flowcv.com/", "_blank")}>Open CVFlow</Button>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Upload Zone */}
            <motion.div {...anim(0.15)} className="lg:col-span-3 glass rounded-xl p-6 gradient-border">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex justify-between">
                {cvData ? "Replace CV" : t('cv_upload_box')}
              </h2>
              
              <div className="relative">
                <input 
                  type="file" 
                  accept="application/pdf"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  onChange={handleFileUpload}
                  ref={fileInputRef}
                  disabled={isUploading}
                />
                <div className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all 
                  ${isUploading ? 'border-primary bg-primary/5 opacity-50' : 'border-border hover:border-primary/40 group'}`}
                     style={!isUploading && !cvData ? {
                       borderImage: "linear-gradient(135deg, hsl(var(--success)), hsl(var(--primary))) 1",
                       borderImageSlice: 1,
                     } : {}}
                >
                  <div className={`h-14 w-14 rounded-full flex items-center justify-center mb-4 transition-colors
                    ${isUploading ? 'bg-primary/20 animate-pulse' : 'bg-primary/10 group-hover:bg-primary/20'}`}>
                    {isUploading ? (
                      <RefreshCw className="h-7 w-7 text-primary animate-spin" />
                    ) : (
                      <Upload className="h-7 w-7 text-primary" />
                    )}
                  </div>
                  
                  {isUploading ? (
                     <p className="text-sm font-medium text-foreground">Parsing PDF Content...</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        {cvData ? "Drag & Drop to REPLACE your CV" : "Drag & Drop your PDF CV"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 mb-4">Max 10MB • Text-based PDF only • Max 1 CV active</p>
                      <Button variant={cvData ? "outline" : "hero"} size="sm" className={cvData ? "border-primary text-primary" : "pointer-events-none"}>
                        {cvData ? "Replace Active CV" : "Select PDF Document"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              
              {cvData && (
                <p className="text-xs text-muted-foreground text-center mt-4 flex items-center justify-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Uploading a new CV will permanently delete the current one.
                </p>
              )}
            </motion.div>
          </div>

          {/* CV Preview */}
          <AnimatePresence>
            {cvData && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="glass rounded-xl p-6 gradient-border overflow-hidden"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    CV Preview
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* View Original PDF Button */}
                    {cvData.blob_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title="Open Original PDF"
                        onClick={() => window.open(cvData.blob_url, "_blank")}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    )}
                    {/* Page count badge */}
                    <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-mono text-[10px]">
                      {cvData.page_images?.length
                        ? `${cvData.page_images.length} page${cvData.page_images.length > 1 ? "s" : ""}`
                        : `${cvData.text_length.toLocaleString()} chars`}
                    </Badge>
                  </div>
                </div>
                
                {/* PNG Image-based Preview (new) */}
                {cvData.page_images && cvData.page_images.length > 0 ? (
                  <div className="bg-muted/30 rounded-lg border border-border/50 p-4 overflow-y-auto max-h-[75vh] scroll-smooth space-y-4">
                    {cvData.page_images.map((imgUrl, idx) => (
                      <div key={`cv-page-${idx}`} className="mx-auto max-w-[820px]">
                        <img
                          src={imgUrl}
                          alt={`CV Page ${idx + 1}`}
                          className="w-full rounded-sm border border-border shadow-md bg-white"
                          loading="lazy"
                          draggable={false}
                        />
                        {cvData.page_images!.length > 1 && (
                          <p className="text-center text-[10px] text-muted-foreground mt-1">
                            Page {idx + 1} of {cvData.page_images!.length}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Fallback: text-based preview for legacy CVs */
                  <>
                    <p className="text-xs text-muted-foreground mb-4">
                      Text-based preview from parsed CV. Upload a new PDF to see full visual preview.
                    </p>
                    <div className="bg-muted/30 rounded-lg border border-border/50 p-4 overflow-auto max-h-[640px]">
                      <div className="mx-auto w-full max-w-[820px]">
                        <div className="mx-auto bg-white text-zinc-900 rounded-sm border border-zinc-200 shadow-[0_8px_28px_rgba(0,0,0,0.08)] min-h-[400px] p-10">
                          <div className="space-y-2 text-sm leading-relaxed">
                        {cvData.text_preview.split(/\n+/).map((line, idx) => {
                          const trimmed = line.trim();
                          if (!trimmed) return <div key={`line-${idx}`} className="h-2" />;
                          if (isHeadingLike(trimmed)) {
                            return (
                              <h3 key={`line-${idx}`} className="mt-4 first:mt-0 text-xs font-bold tracking-[0.14em] uppercase text-zinc-700">
                                {trimmed.replace(/:$/, "")}
                              </h3>
                            );
                          }
                          return (
                            <p key={`line-${idx}`} className="text-zinc-800">
                              {trimmed}
                            </p>
                          );
                        })}
                        {cvData.text_length > 2000 && (
                          <p className="text-xs text-zinc-500 mt-4">[Preview dipotong otomatis untuk performa]</p>
                        )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  </DashboardLayout>
  );
};

export default CVManager;
