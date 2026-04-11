import { FileText, LayoutTemplate, PenTool } from "lucide-react";

export const templates = [
  { id: "harvard", name: "Minimalist Elite", desc: "Harvard Standard. Zero distraction. High density. Best for FAANG backend/systems roles.", icon: FileText },
  { id: "tech", name: "Tech-Focused FAANG", desc: "Highlights Tech Stack & GitHub early. Best for frontend and full-stack engineers.", icon: LayoutTemplate },
  { id: "exec", name: "Executive Strategy", desc: "Stanford/Wharton format. Focuses heavily on Business Impact and OKR metrics.", icon: PenTool },
];

export type ExperienceEntry = {
  company: string;
  role: string;
  location: string;
  start: string;
  end: string;
  bullets: string;
};

export type EducationEntry = {
  school: string;
  degree: string;
  location: string;
  year: string;
  details: string;
};

export type BuilderForm = {
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

export type BuilderSectionKey = "summary" | "experience" | "education" | "skills" | "certifications";

export const defaultSectionOrder: BuilderSectionKey[] = [
  "summary",
  "experience",
  "education",
  "skills",
  "certifications",
];

export const BUILDER_DRAFT_KEY_BASE = "fyjob_cv_builder_draft_v1";
export const CV_CACHE_KEY_BASE = "fyjob_cv_cache";

export const createEmptyExperience = (): ExperienceEntry => ({
  company: "",
  role: "",
  location: "",
  start: "",
  end: "",
  bullets: "",
});

export const createEmptyEducation = (): EducationEntry => ({
  school: "",
  degree: "",
  location: "",
  year: "",
  details: "",
});

export const initialBuilderForm: BuilderForm = {
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

export const builderSteps = ["Profile", "Summary", "Experience", "Education", "Skills", "Review"];

export const splitBullets = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean);

export const splitList = (text: string): string[] =>
  text
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const buildCVText = (form: BuilderForm, sectionOrder: BuilderSectionKey[]): string => {
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

        splitBullets(exp.bullets).forEach((bullet) => blocks.push(`- ${bullet}`));
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

export const isHeadingLike = (line: string): boolean => {
  const value = line.trim();
  if (!value) return false;
  const short = value.length <= 40;
  const uppercase = value === value.toUpperCase() && /[A-Z]/.test(value);
  return value.endsWith(":") || (short && uppercase);
};

export const getATSInsights = (form: BuilderForm) => {
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

export const getBuilderFilename = (name: string) => {
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
    return `${baseCSS}
      body { font-family: 'Courier New', monospace; }
      h1 { font-family: Arial, sans-serif; }
      .skill-item { display: inline-block; margin-right: 8px; padding: 2px 5px; background-color: #f0f0f0; border-radius: 3px; font-size: 9px; }
    `;
  }

  if (template === "exec") {
    return `${baseCSS}
      body { font-family: 'Georgia', serif; }
      h1 { font-family: 'Georgia', serif; }
    `;
  }

  return baseCSS;
};

export const generateHTMLPreview = (text: string, template: string): string => {
  const lines = text.split("\n");
  const html = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<p></p>";
      if (isHeadingLike(trimmed)) return `<h2>${trimmed.replace(/:$/, "")}</h2>`;
      if (trimmed.startsWith("-")) {
        return `<div class="bullet">•&nbsp;${trimmed.replace(/^[-*•\s]+/, "").trim()}</div>`;
      }
      if (line.length > 0 && !line.startsWith(" ")) return `<h3>${trimmed}</h3>`;
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

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });