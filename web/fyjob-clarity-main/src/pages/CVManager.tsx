import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, CheckCircle2, Clock, RefreshCw, Trash2, LayoutTemplate, PenTool, Download, AlertCircle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { uploadCV, getCVPreview, deleteCV, CVPreview as CVPreviewType } from "@/lib/api";
import * as pdfjsLib from 'pdfjs-dist';

// Set PDF.js worker from CDN to avoid bundler issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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

const CVManager = () => {
  const { t } = useTranslation();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [cvData, setCvData] = useState<CVPreviewType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load CV Preview
  const fetchCV = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const data = await getCVPreview();
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

  // Handle PDF text extraction
  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        // Add a line break after each string line to preserve basic formatting
        fullText += strings.join(" ") + "\n\n";
    }
    return fullText;
  };

  // Handle File Upload
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
      
      const parsedText = await extractTextFromPDF(file);
      
      if (parsedText.length < 50) {
        throw new Error("Could not extract enough text from PDF. Ensure it's not a scanned image.");
      }

      await uploadCV(parsedText, file.name);
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
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete CV");
      setIsLoading(false);
    }
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

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md bg-card border border-border">
          <TabsTrigger value="upload">{t('cv_tab_upload')}</TabsTrigger>
          <TabsTrigger value="builder" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary disabled:opacity-50">
             <PenTool className="h-4 w-4 mr-2" /> {t('cv_tab_build')} (Soon)
          </TabsTrigger>
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
                  <p className="text-xs text-muted-foreground mt-1 px-4">Upload a PDF to enable AI job analysis.</p>
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

          {/* Extracted Text Preview */}
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
                    Extracted Text Preview
                  </h2>
                  <Badge variant="outline" className="bg-success/10 text-success border-success/30 font-mono text-[10px]">
                    {cvData.text_length.toLocaleString()} chars mapped
                  </Badge>
                </div>
                
                <p className="text-xs text-muted-foreground mb-4">
                  This is the raw content the AI uses to match you against job descriptions. Ensure all your skills and experiences are visible below.
                </p>
                
                <div className="bg-zinc-950/80 rounded-lg border border-border/50 p-5 overflow-auto max-h-[500px] shadow-inner relative">
                  <div className="absolute top-0 right-0 p-3 pointer-events-none">
                     <FileText className="w-24 h-24 text-primary/5 -rotate-12" />
                  </div>
                  <pre className="text-sm font-mono text-muted-foreground/80 leading-relaxed whitespace-pre-wrap relative z-10">
                    {cvData.text_preview}
                    {cvData.text_length > 2000 && "\n\n[... Truncated for preview ...]"}
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="builder" className="mt-6">
           <div className="glass rounded-xl p-12 flex flex-col items-center justify-center text-center opacity-80 border-dashed border-2">
              <PenTool className="w-16 h-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-bold mb-2">Resume Builder Engine</h2>
              <p className="text-muted-foreground max-w-md">Our God-Tier ATS templates are currently being trained on 10k+ winning FAANG applications. This feature will unlock soon.</p>
              <Button variant="outline" className="mt-6 border-primary/50 text-primary pointer-events-none">Coming in v1.2</Button>
           </div>
        </TabsContent>
      </Tabs>
    </div>
  </DashboardLayout>
  );
};

export default CVManager;
