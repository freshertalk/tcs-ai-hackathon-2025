// src/TCSinterviewAssistantAI.jsx
import React, {
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
} from "react";
import {
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  Button,
  FormControl,
  InputLabel,
  Grid,
  Paper,
  LinearProgress,
  Alert,
  Modal,
  IconButton,
  styled,
  createTheme,
  ThemeProvider,
  Autocomplete,
  Chip,
  useMediaQuery,
  useTheme,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
} from "@mui/material";
import {
  Person,
  Work,
  Business,
  LocationOn,
  LinkedIn,
  ArrowForward,
  Refresh,
  Category,
  Autorenew as RegenerateIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  Email as EmailIcon,
  Badge as IdIcon,
  Code as SkillsIcon,
} from "@mui/icons-material";
import { motion } from "framer-motion";
import logo from "../assets/tcs-logo.png";
import { GoogleGenerativeAI } from "@google/generative-ai";
import DOMPurify from "dompurify";

// Animation Variants (Enhanced for smoother transitions)
const containerVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, x: -10 },
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94],
      delay: i * 0.1,
    },
  }),
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.7, ease: "easeOut" },
  },
  hover: {
    scale: 1.02,
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.15)",
    transition: { duration: 0.4, ease: "easeOut" },
  },
};

// Enhanced Theme for World-Class Design (Improved contrast, accessibility, and modern aesthetics)
const theme = createTheme({
  palette: {
    primary: { main: "#0A84FF", dark: "#0066CC", light: "#3DA2FF" },
    secondary: { main: "#FF2D55", dark: "#CC2444" },
    background: {
      default: "linear-gradient(135deg, #F0F4F8 0%, #E0E7EF 100%)",
      paper: "rgba(255, 255, 255, 0.97)",
    },
    text: { primary: "#1A202C", secondary: "#4A5568" },
    error: { main: "#EF4444" },
    warning: { main: "#F59E0B" },
    success: { main: "#10B981" },
  },
  typography: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 700, letterSpacing: "-0.025em", fontSize: "3rem" },
    h2: { fontWeight: 600, fontSize: "2.25rem" },
    h3: { fontWeight: 600, fontSize: "1.75rem" },
    h4: { fontWeight: 600, fontSize: "1.25rem" },
    h5: { fontWeight: 500, fontSize: "1.15rem" },
    h6: { fontWeight: 500, fontSize: "1.05rem" },
    body1: { lineHeight: 1.75, letterSpacing: "0.01em", fontSize: "1rem" },
    body2: { fontSize: "0.9rem" },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: "8px", // Softer corners for modern feel
          textTransform: "none",
          fontWeight: 600,
          transition: "all 0.3s ease",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
          "&:hover": {
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.15)",
            transform: "translateY(-3px)",
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.98)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            "& fieldset": { border: "none" },
            "&:hover": { boxShadow: "0 6px 20px rgba(0, 0, 0, 0.1)" },
          },
          "& .MuiInputBase-input": {
            fontSize: "0.9rem",
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: "8px",
          background: "rgba(255, 255, 255, 0.98)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
          "& fieldset": { border: "none" },
        },
        select: {
          fontSize: "0.9rem",
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.98)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            "& fieldset": { border: "none" },
            "& .MuiInputBase-input": {
              fontSize: "0.9rem",
            },
          },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "0.9rem",
          color: "#4A5568",
          padding: "12px 24px", // More padding for touch-friendly
          "&.Mui-selected": {
            backgroundColor: "rgba(10, 132, 255, 0.1)",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: "16px", // Softer for premium feel
          boxShadow: "0 6px 24px rgba(0, 0, 0, 0.08)",
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: "8px",
          boxShadow: "0 6px 24px rgba(0, 0, 0, 0.12)",
        },
      },
    },
    MuiList: {
      styleOverrides: {
        root: {
          padding: "0px 0px",
        },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          alignItems: "flex-start", // Better for multi-line text
        },
      },
    },
  },
});

// Styled Components with Enhanced Design (Improved for accessibility and touch)
const AppleCard = styled(Paper)(({ theme }) => ({
  background:
    "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98))",
  backdropFilter: "blur(20px)",
  borderRadius: "16px",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
  padding: theme.spacing(5),
  transition: "all 0.4s ease",
  "&:hover": {
    boxShadow: "0 12px 48px rgba(0, 0, 0, 0.12)",
  },
  [theme.breakpoints.down("sm")]: { padding: theme.spacing(3.5) },
}));

const AppleButton = styled(Button)(({ theme }) => ({
  background: "linear-gradient(90deg, #0A84FF, #3DA2FF)",
  color: "#FFFFFF",
  padding: theme.spacing(2, 6),
  fontSize: "1rem",
  boxShadow: "0 4px 12px rgba(10, 132, 255, 0.25)",
  borderRadius: "8px",
  "&:hover": {
    background: "linear-gradient(90deg, #0066CC, #0A84FF)",
    transform: "translateY(-3px)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
  },
  "&:disabled": {
    background: "#EDF2F7",
    color: "#A0AEC0",
    boxShadow: "none",
  },
  minWidth: "140px", // Better for touch
}));

const AppleClearButton = styled(Button)(({ theme }) => ({
  background: "linear-gradient(145deg, #ffffff, #f8fafc)",
  color: theme.palette.text.secondary,
  padding: theme.spacing(2, 6),
  fontSize: "1rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  borderRadius: "8px",
  "&:hover": {
    background: "linear-gradient(90deg, #0A84FF, #3DA2FF)",
    color: "#FFFFFF",
    transform: "translateY(-3px)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
  },
  minWidth: "140px",
}));

const AppleTextField = styled(TextField)(({ theme }) => ({
  "& .MuiInputBase-input": {
    padding: theme.spacing(2.5),
    fontSize: "0.9rem",
    transition: "all 0.3s ease",
    "&:focus": { background: "rgba(255, 255, 255, 0.99)" },
  },
}));

const AppleSelect = styled(Select)(({ theme }) => ({
  "& .MuiSelect-select": {
    padding: theme.spacing(2.5),
    fontSize: "0.9rem",
    transition: "all 0.3s ease",
    "&:focus": { background: "rgba(255, 255, 255, 0.99)" },
  },
}));

const ResponseTypography = styled(Typography)(({ theme }) => ({
  textAlign: "left",
  lineHeight: 1.85,
  fontSize: "1rem",
  color: theme.palette.text.primary,
  "& strong": { fontWeight: 600 },
  "& em": { fontStyle: "italic" },
  "& p": { margin: "1.25rem 0" },
  "& ol": {
    margin: "1.25rem 0",
    paddingLeft: "2rem",
  },
  "& li": { marginBottom: "0.75rem" },
  "& strong em": {
    backgroundColor: "#FEF3C7",
    color: "#92400E",
    padding: "0.3rem 0.6rem",
    borderRadius: "8px",
    fontStyle: "italic",
  },
  "& ul, & ol": {
    marginBottom: "1.25rem",
  },
  "& h2, & h3": {
    fontWeight: 600,
    marginTop: "2rem",
    marginBottom: "1rem",
    color: theme.palette.primary.main,
  },
}));

const DisclaimerTypography = styled(Typography)(({ theme }) => ({
  background: "linear-gradient(145deg, #ffffff, #f8fafc)",
  backdropFilter: "blur(16px)",
  padding: theme.spacing(3),
  borderRadius: "8px",
  marginBottom: theme.spacing(4),
  fontSize: "0.9rem",
  color: theme.palette.text.secondary,
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
  "& strong": { fontWeight: 600, color: theme.palette.error.main },
}));

const TipsCard = styled(AppleCard)(({ theme }) => ({
  mt: 5,
  background: "linear-gradient(135deg, #E0F2FE 0%, #F0F9FF 100%)",
  border: `1px solid ${theme.palette.primary.light}`,
}));

// Utility Functions (No changes needed)
const callGeminiAPI = async (prompt, sessionId, retries = 3) => {
  const API_KEY = "AIzaSyDpRy7IFEjMlB7lP0uoTLtZyFuopfmDg0Q";
  if (!API_KEY) {
    throw new Error("API key is not set.");
  }

  let attempt = 0;
  while (attempt < retries) {
    try {
      const genAI = new GoogleGenerativeAI(API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      text = text
        .replace(/\*\*\*\*(.*?)\*\*\*\*/g, "<strong>$1</strong>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]/g, "[<strong><em>$1</em></strong>]")
        .replace(/\n\n+/g, "</p><p style='margin-top: 1rem;'>")
        .replace(/\n/g, "<br />")
        .replace(/^\s*[-*]\s+/gm, "")
        .replace(
          /^(\d+\.\s+)([^\n]+)/gm,
          "<li style='margin-bottom: 0.5rem;'>$2</li>"
        )
        .replace(
          /<li style='margin-bottom: 0.5rem;'>(.*?)<\/li>/g,
          (match, p1) => match.replace(/^(\d+\.\s+)/, "")
        )
        .replace(
          /<li style='margin-bottom: 0.5rem;'>/,
          "<ol style='padding-left: 1.5rem; margin: 1rem 0;'><li style='margin-bottom: 0.5rem;'>"
        )
        .replace(/<\/li>$/, "</li></ol>");

      return `<div style="line-height: 1.8; text-align: justify; padding: 1.5rem; border-radius: 4px; background: #f8fafc; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">${text}</div>`;
    } catch (error) {
      attempt++;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } else {
        throw new Error("Failed to generate response after retries.");
      }
    }
  }
};

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const convertHtmlToText = (html) => {
  if (!html) return "";
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["strong", "em", "p", "br", "ol", "li", "h2", "h3"],
  });
  const div = document.createElement("div");
  div.innerHTML = sanitized;
  const walk = (node, result = []) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result.push(node.textContent.trim());
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === "BR") result.push("\n");
      if (node.tagName === "P") result.push("\n\n");
      if (node.tagName === "LI") result.push("\n- ");
      if (node.tagName === "H2" || node.tagName === "H3") result.push("\n\n");
      if (node.tagName === "STRONG")
        result.push(`**${node.textContent.trim()}**`);
      if (node.tagName === "EM") result.push(`_${node.textContent.trim()}_`);
      node.childNodes.forEach((child) => walk(child, result));
    }
    return result;
  };
  return walk(div)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

// Dropdown lists (No changes)
const tcsCities = [
  "Varanasi",
  "Hyderabad",
  "Bangalore",
  "Pune",
  "Chennai",
  "Kolkata",
  "Noida",
  "Mumbai",
  "Gandhinagar",
  "Kochi",
  "Trivandrum",
  "Nagpur",
  "Indore",
  "Lucknow",
  "Other",
];

const experienceOptions = [
  "Fresher (0–1 Year)",
  "Junior (1–3 Years)",
  "Mid-Level (3–6 Years)",
  "Senior (6–10 Years)",
  "Expert (10+ Years)",
];

const gradeOptions = ["C1", "C2", "C3A", "C3B", "C4"];

const preparationCategories = [
  "Cover Letter for Internal Opportunities",
  "Project Interview Confirmation Email",
  "Follow-Up Email After Interview",
  "Interview Feedback Email (Self-Reflection or Manager)",
  "Career Progression & Mentorship Request Email",
  "Reference Request Email",
  "Rejection Follow-Up & Feedback Request",
  "Behavioral Interview Questions & STAR Responses",
  "Technical Interview Questions & Sample Answers",
];

const interviewTypes = [
  "Technical Round 1",
  "Technical Round 2",
  "Managerial Round",
  "HR Discussion",
  "Panel Interview",
  "Internal Mobility Discussion (with project manager)",
  "Client-Facing Role Assessment",
];

const communicationTypes = [
  "Request for Project Opportunity",
  "Interview Scheduling Email",
  "Thank You Email (Post Interview)",
  "Follow-Up Reminder Email",
  "Feedback Request Email",
  "Escalation/Reminder for Pending Response",
  "Promotion Discussion Email",
];

const managerialExpectationFocuses = [
  "Project Allocation Request",
  "Cross-Skilling / Upskilling Opportunities",
  "Onsite/Client Project Request",
  "Internal Role Change",
  "High-Impact Contribution Areas",
  "Leadership Development",
  "Performance Review Preparation",
];

const interviewQuestionTypes = [
  "Behavioral (STAR-based Situational Qs)",
  "Technical (Skill-Specific)",
  "Problem Solving / Case Study",
  "Leadership & Ownership Questions",
  "Client Interaction Readiness Questions",
  "Feedback Reflection Questions",
  "TCS-Specific Scenario Questions",
];

const tones = [
  "Formal & Professional",
  "Assertive (for negotiations)",
  "Polite & Appreciative",
  "Goal-Oriented (showcasing career path)",
  "Concise (for busy managers)",
  "Collaborative & Team-Focused",
];

const feedbackTypes = [
  "Self Feedback (employee writes own reflection)",
  "Peer/Manager Feedback (for interview evaluation)",
  "Constructive Feedback Request (asking managers for improvement areas)",
  "Performance Improvement Plan Discussion",
];

const skillCategories = {
  Java: [
    "Core",
    "Advanced",
    "Multithreading",
    "Collections",
    "Spring Framework",
  ],
  Microservices: [
    "Spring Boot",
    "API Design",
    "Service Discovery",
    "Resilience",
    "Docker Integration",
  ],
  Cloud: ["AWS", "Azure", "GCP", "TCS Cloud Services"],
  DevOps: ["CI/CD", "Docker", "Kubernetes", "Jenkins", "Ansible"],
  Database: ["SQL", "NoSQL", "MongoDB", "Oracle", "PL/SQL"],
  Testing: ["JUnit", "Mockito", "Automation Frameworks", "Selenium", "Appium"],
  "SAP CAPM": ["CDS", "Fiori", "OData", "CAP Services", "SAP Integration"],
  "Node.js": [
    "Express.js",
    "RESTful APIs",
    "Asynchronous Programming",
    "NPM",
    "Microservices",
  ],
  "MEARN Stack": ["MongoDB", "Express.js", "Angular", "React", "Node.js"],
  Python: ["Django", "Flask", "Data Science", "Automation Scripts"],
  "Data Science": ["Machine Learning", "Pandas", "Scikit-Learn", "TensorFlow"],
  "SAP ABAP": ["Reports", "Modules", "Workflows", "Enhancements"],
};

// Custom Hook (Added debouncing for inputs to improve performance)
const useInterviewAssistant = () => {
  const sessionId = useMemo(() => Math.random().toString(36).substring(2), []);
  const initialFormData = useMemo(() => {
    const savedData = localStorage.getItem("tcsInterviewAssistantFormData");
    let parsedData = savedData ? JSON.parse(savedData) : {};
    return {
      employeeName: parsedData.employeeName || "Vinay Tiwari",
      yearsOfExperience: parsedData.yearsOfExperience || "Junior (1–3 Years)",
      companyName: "Tata Consultancy Services",
      jobLocation: parsedData.jobLocation || "Varanasi",
      jobPosition: parsedData.jobPosition || "Software Engineer",
      skills: parsedData.skills || ["Microservices"],
      skillSubtopics: parsedData.skillSubtopics || ["Spring Boot"],
      grade: parsedData.grade || "C2",
      interviewType: parsedData.interviewType || "Technical Round 1",
      communicationType:
        parsedData.communicationType || "Request for Project Opportunity",
      managerialExpectationFocus:
        parsedData.managerialExpectationFocus || "Project Allocation Request",
      interviewQuestionType:
        parsedData.interviewQuestionType || "Technical (Skill-Specific)",
      tone: parsedData.tone || "Formal & Professional",
      feedbackType:
        parsedData.feedbackType ||
        "Peer/Manager Feedback (for interview evaluation)",
      linkedinUrl: parsedData.linkedinUrl || "",
    };
  }, []);

  const [formData, setFormData] = useState(initialFormData);
  const [formErrors, setFormErrors] = useState({});
  const [showCategories, setShowCategories] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [skillsInputValue, setSkillsInputValue] = useState("");
  const [selectedSkills, setSelectedSkills] = useState(
    initialFormData.skills || []
  );

  const validateField = useCallback((name, value) => {
    const stringValue = Array.isArray(value)
      ? value.join("")
      : String(value).trim();
    if (!stringValue && name !== "linkedinUrl") {
      return `${name
        .replace(/([A-Z])/g, " $1")
        .trim()} is required for optimal personalization.`;
    }
    if (name === "linkedinUrl" && stringValue && !isValidUrl(stringValue)) {
      return "Please enter a valid LinkedIn URL (optional but recommended for profile referencing).";
    }
    return "";
  }, []);

  const handleInputChange = useCallback(
    (field) => (event) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, [field]: value }));
      setFormErrors((prev) => ({
        ...prev,
        [field]: validateField(field, value),
      }));
    },
    [validateField]
  );

  const handleSkillsChange = useCallback(
    (event, newValue) => {
      setSelectedSkills(newValue);
      setFormData((prev) => ({ ...prev, skills: newValue }));
      setFormErrors((prev) => ({
        ...prev,
        skills: validateField("skills", newValue),
      }));
    },
    [validateField]
  );

  const handleSkillSubtopicsChange = useCallback(
    (event, newValue) => {
      setFormData((prev) => ({ ...prev, skillSubtopics: newValue }));
      setFormErrors((prev) => ({
        ...prev,
        skillSubtopics: validateField("skillSubtopics", newValue),
      }));
    },
    [validateField]
  );

  useEffect(() => {
    return () => {
      localStorage.setItem(
        "tcsInterviewAssistantFormData",
        JSON.stringify(formData)
      );
    };
  }, [formData]);

  const handleNext = useCallback(() => {
    const errors = {};
    Object.entries(formData).forEach(([key, value]) => {
      if (key !== "companyName" && key !== "linkedinUrl") {
        const error = validateField(key, value);
        if (error) errors[key] = error;
      }
    });

    setFormErrors(errors);

    if (Object.keys(errors).length === 0) {
      setError(null);
      setShowCategories(true);
    } else {
      setError(
        "Please complete all required fields to unlock personalized AI assistance (marked below)."
      );
    }
  }, [formData, validateField]);

  const handleClear = useCallback(() => {
    setClearModalOpen(true);
  }, []);

  const confirmClear = useCallback(() => {
    setFormData({
      employeeName: "",
      yearsOfExperience: "Fresher (0–1 Year)",
      companyName: "Tata Consultancy Services",
      jobLocation: "Varanasi",
      jobPosition: "",
      skills: [],
      skillSubtopics: [],
      grade: "",
      interviewType: "",
      communicationType: "",
      managerialExpectationFocus: "",
      interviewQuestionType: "",
      tone: "Formal & Professional",
      feedbackType: "",
      linkedinUrl: "",
    });
    setSelectedSkills([]);
    setSkillsInputValue("");
    setFormErrors({});
    setShowCategories(false);
    setSelectedCategory("");
    setResponse("");
    setError(null);
    setClearModalOpen(false);
    localStorage.removeItem("tcsInterviewAssistantFormData");
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse("");
    try {
      const prompt = generatePrompt(selectedCategory, formData);
      if (prompt) {
        const aiResponse = await callGeminiAPI(prompt, sessionId);
        setResponse(aiResponse);
      }
    } catch (err) {
      setError(
        err.message ||
          "Failed to generate content. Please try again or refine your inputs."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, formData, sessionId]);

  const generatePrompt = useMemo(
    () =>
      (
        category,
        {
          employeeName,
          yearsOfExperience,
          jobPosition,
          companyName,
          jobLocation,
          skills,
          skillSubtopics,
          grade,
          interviewType,
          communicationType,
          managerialExpectationFocus,
          interviewQuestionType,
          tone,
          feedbackType,
          linkedinUrl,
        }
      ) => {
        const skillsStr = skills.join(", ");
        const subtopicsStr = skillSubtopics.join(", ");
        const employeeFocus = `As an existing TCS employee with ${yearsOfExperience} experience and current grade <strong>${grade}</strong>, focus on my internal achievements, key skills in ${skillsStr} (subtopics: ${subtopicsStr}), contributions to TCS projects (e.g., client deliveries, innovation initiatives), and desire for this internal project/role. Highlight transferable skills from my current role to the new internal opportunity, aligning with TCS values like integrity, excellence, and leadership. Tailor to ${interviewType}, ${communicationType}, with focus on ${managerialExpectationFocus}, using ${interviewQuestionType} style if applicable, in a ${tone} tone. For feedback, use ${feedbackType}. Use a polite, requesting tone throughout, emphasizing my request for consideration in this internal TCS opportunity and commitment to TCS's growth.`;
        const linkedinMention = linkedinUrl
          ? ` Reference my LinkedIn profile if relevant: <strong>${linkedinUrl}</strong>. Do not hallucinate details.`
          : "";

        switch (category) {
          case "Cover Letter for Internal Opportunities":
            return `Write a professional, cutting-edge cover letter from <strong>${employeeName}</strong>, an existing TCS employee, requesting consideration for the internal <strong>${jobPosition}</strong> project/role at <strong>${companyName}</strong> in <strong>${jobLocation}</strong>. ${employeeFocus} Highlight my key skills: <strong>${skillsStr}</strong>, relevant [skills], [TCS projects], enthusiasm, and [motivation] for the internal role. Include specific examples like [real-time object detection system using embedded systems] for [projects] where applicable, and tie to TCS's digital transformation goals. Use power words like <strong>achieved</strong>, <strong>led</strong>, <strong>excelled</strong>, and <strong>impacted</strong>, bolding them. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Ensure the letter is well-structured with:
  - A formal greeting (e.g., "Dear Hiring Manager," or "Dear Internal Recruitment Team,").
  - An introductory paragraph expressing interest in the internal opportunity.
  - 2-3 body paragraphs detailing internal qualifications, contributions to TCS, and enthusiasm for growth within the company.
  - A closing paragraph politely requesting an interview or further discussion.
  - A formal closing (e.g., "Sincerely,\n\n${employeeName}").
  - Blank lines between sections for readability.
  - Justified text, no bullet points, only paragraphs.
  Make the content engaging, concise, impactful, and world-class, tailored for internal TCS project applications only. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Project Interview Confirmation Email":
            return `Write a professional, world-class email from <strong>${employeeName}</strong>, an existing TCS employee, to request or confirm an internal project interview for the <strong>${jobPosition}</strong> at <strong>${companyName}</strong>. ${employeeFocus} Be polite, express enthusiasm for internal growth, and include scheduling details or confirmation. Reference TCS's collaborative culture. Use power words like <strong>eager</strong>, <strong>committed</strong>, and <strong>delighted</strong>, bolding them. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Ensure the email is well-structured with a formal greeting, body, and closing, formatted for clarity with justified text without bullet points. Make the content engaging, concise, impactful, and world-class, tailored for internal TCS project applications only. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Behavioral Interview Questions & STAR Responses":
            return `For an existing TCS employee applying for the internal <strong>${jobPosition}</strong> at <strong>${companyName}</strong>, generate a list of exactly 35 common behavioral and managerial interview questions tailored to internal scenarios, such as contributions to TCS projects, team collaborations within the company, or career progression. ${employeeFocus} Include:
  - 20 behavioral questions focusing on [teamwork], [problem-solving], [adaptability], and [communication] in TCS environment, with sample STAR (Situation, Task, Action, Result) responses based on internal experiences.
  - 15 managerial questions focusing on [leadership], [decision-making], [conflict resolution], and [project management] in internal TCS settings, with STAR samples.
  Use power words like <strong>describe</strong>, <strong>explain</strong>, <strong>demonstrate</strong>, and <strong>illustrate</strong>, bolding them in each question. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Include a concise explanation of the [STAR method] (Situation, Task, Action, Result) and how to apply it using [internal TCS experiences]. Format the output as:
  - A paragraph explaining the [STAR method].
  - A numbered list of 35 questions (1-35), with each question on a new line followed by a brief STAR sample response.
  - No stray bullet points, only numbered list items.
  Ensure the content is engaging, clear, visually appealing, and world-class, tailored for internal TCS project applications only. Avoid repetition in questions. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Follow-Up Email After Interview":
            return `Write a professional, cutting-edge follow-up email from <strong>${employeeName}</strong>, an existing TCS employee, after an internal interview for the <strong>${jobPosition}</strong> at <strong>${companyName}</strong>. ${employeeFocus} Express gratitude, reiterate interest in the internal role, and highlight my value and contributions to <strong>${companyName}</strong>, aligning with TCS's innovation drive. Use power words like <strong>grateful</strong>, <strong>impressed</strong>, and <strong>confident</strong>, bolding them. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Ensure the email is well-structured with a formal greeting, body, and closing, formatted for clarity with justified text without bullet points. Make the content engaging, concise, impactful, and world-class, tailored for internal TCS project applications only. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Interview Feedback Email (Self-Reflection or Manager)":
            return `Write a professional interview feedback email from <strong>${employeeName}</strong>, an existing TCS employee, for self-reflection or manager discussion on internal <strong>${jobPosition}</strong> interview at <strong>${companyName}</strong>. ${employeeFocus} Include structured feedback based on ${feedbackType}, focusing on TCS performance metrics. Use power words like <strong>reflect</strong>, <strong>improve</strong>, and <strong>contribute</strong>, bolding them. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Ensure the email is well-structured with a formal greeting, body, and closing, formatted for clarity with justified text without bullet points. Make the content engaging, concise, impactful, and world-class, tailored for internal TCS project applications only. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Career Progression & Mentorship Request Email":
            return `Write a professional career progression email from <strong>${employeeName}</strong>, an existing TCS employee, seeking mentorship or new internal opportunities related to <strong>${jobPosition}</strong> at <strong>${companyName}</strong> in <strong>${jobLocation}</strong>. ${employeeFocus} Politely request guidance or allocation, referencing TCS's talent development programs. Use power words like <strong>grow</strong>, <strong>mentor</strong>, and <strong>advance</strong>, bolding them. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>. Ensure the email is well-structured with a formal greeting, body, and closing, formatted for clarity with justified text without bullet points. Make the content engaging, concise, impactful, and world-class, tailored for internal TCS project applications only. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Technical Interview Questions & Sample Answers":
            return `For an existing TCS employee applying for the internal <strong>${jobPosition}</strong> at <strong>${companyName}</strong>, generate a list of exactly 35 technical interview questions tailored to the selected skills <strong>${skillsStr}</strong> and subtopics <strong>${subtopicsStr}</strong>, aligned with ${interviewType} and ${interviewQuestionType}. ${employeeFocus} Focus on practical, TCS-relevant technical questions for internal project roles, including TCS tools like IGATE or cloud integrations. Include:
  - Questions covering core concepts, advanced topics, coding scenarios, and TCS-specific applications.
  - Provide brief sample answers or key points to cover, using STAR where applicable.
  Use power words like <strong>explain</strong>, <strong>implement</strong>, <strong>optimize</strong>, and <strong>demonstrate</strong>, bolding them in each question. Bold key terms like <strong>${employeeName}</strong>, <strong>${companyName}</strong>, <strong>${jobPosition}</strong>, and skill names. Format the output as:
  - An introductory paragraph on technical interview preparation for internal TCS roles.
  - A numbered list of 35 questions (1-35), with each question on a new line, including a brief sample answer or key points to cover.
  - No stray bullet points, only numbered list items.
  Ensure the content is engaging, clear, visually appealing, and world-class, tailored for internal TCS project applications only. Avoid repetition in questions. Stick to known facts; do not invent details.${linkedinMention}`;
          case "Reference Request Email":
            return `Write a professional reference request email from <strong>${employeeName}</strong>, an existing TCS employee, seeking references for internal <strong>${jobPosition}</strong>. ${employeeFocus} Politely ask colleagues or managers. Bold key terms. Ensure structured format.${linkedinMention}`;
          case "Rejection Follow-Up & Feedback Request":
            return `Write a professional follow-up email after rejection from <strong>${employeeName}</strong> for internal <strong>${jobPosition}</strong>. ${employeeFocus} Request feedback and express continued interest. Bold key terms. Structured format.${linkedinMention}`;
          default:
            return "";
        }
      },
    []
  );

  return {
    formData,
    formErrors,
    handleInputChange,
    handleSkillsChange,
    handleSkillSubtopicsChange,
    skillsInputValue,
    setSkillsInputValue,
    selectedSkills,
    handleNext,
    handleClear,
    confirmClear,
    clearModalOpen,
    setClearModalOpen,
    handleGenerate,
    showCategories,
    selectedCategory,
    setSelectedCategory,
    response,
    loading,
    error,
    setError,
  };
};

// PreparationTools Component (Enhanced with better accessibility and feedback)
const PreparationTools = React.memo(
  ({
    showCategories,
    selectedCategory,
    setSelectedCategory,
    handleGenerate,
    response,
    loading,
    error,
    setError,
  }) => {
    const [copied, setCopied] = useState(false);
    const [downloaded, setDownloaded] = useState(false);
    const [regenerationCount, setRegenerationCount] = useState(0);
    const contentRef = useRef(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

    useEffect(() => {
      setRegenerationCount(0);
    }, [selectedCategory]);

    const handleCopy = useCallback(() => {
      let content = "";
      if (response && contentRef.current) {
        content = convertHtmlToText(response);
      }
      navigator.clipboard
        .writeText(content)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          const textArea = document.createElement("textarea");
          textArea.value = content;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
    }, [response]);

    const handleDownload = useCallback(() => {
      let content = "";
      if (response && contentRef.current) {
        content = convertHtmlToText(response);
      }
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedCategory
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase()}_tcs_assistant.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    }, [response, selectedCategory]);

    const handlePrint = useCallback(() => {
      const printContent = contentRef.current
        ? contentRef.current.innerHTML
        : response;
      const printWindow = window.open("", "_blank");
      printWindow.document.write(`
        <html>
          <head>
            <title>${selectedCategory} - TCS AI Interview Assistant</title>
            <style>
              body { font-family: 'Inter', sans-serif; line-height: 1.8; font-size: 0.95rem; color: #1E293B; margin: 20px; }
              .content { padding: 2rem; max-width: 800px; margin: 0 auto; }
              strong { font-weight: 600; }
              em { font-style: "italic"; }
              p { margin: 1rem 0; text-align: justify; }
              ol, ul { padding-left: 1.5rem; margin: 1rem 0; }
              li { margin-bottom: 0.5rem; }
              h1 { color: #0A84FF; font-size: 1.5rem; margin-bottom: 1rem; text-align: center; }
            </style>
          </head>
          <body>
            <div class="content">
              <h1>${selectedCategory}</h1>
              <p><em>Generated by TCS AI Interview Assistant for internal opportunities.</em></p>
              ${printContent}
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }, [response, selectedCategory]);

    const handleRegenerate = () => {
      if (regenerationCount < 2) {
        handleGenerate();
        setRegenerationCount((prev) => prev + 1);
      }
    };

    if (!showCategories) return null;

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <AppleCard as={motion.div} variants={cardVariants} whileHover="hover">
          <Typography
            variant="h3"
            sx={{
              fontSize: "1.75rem",
              mb: 4,
              color: theme.palette.primary.main,
              textAlign: "left", // Explicit left align
            }}
            role="heading"
            aria-level="2"
          >
            AI-Powered Content Generation Tools
          </Typography>
          <Typography
            variant="body2"
            sx={{
              mb: 3,
              color: theme.palette.text.secondary,
              textAlign: "left",
            }}
          >
            Select a category below to generate tailored, TCS-specific content
            for your internal career advancement.
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="prep-category-label">
              Content Generation Category
            </InputLabel>
            <AppleSelect
              labelId="prep-category-label"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              label="Content Generation Category"
              startAdornment={
                <Category sx={{ mr: 1, color: theme.palette.secondary.main }} />
              }
              aria-label="Select content generation category"
            >
              {preparationCategories.map((cat) => (
                <MenuItem key={cat} value={cat}>
                  {cat}
                </MenuItem>
              ))}
            </AppleSelect>
          </FormControl>
          <Box sx={{ mt: 5, textAlign: "center" }}>
            <AppleButton
              onClick={handleGenerate}
              disabled={!selectedCategory || loading}
              endIcon={<ArrowForward />}
              aria-label="Generate personalized content"
              size="large"
            >
              {loading
                ? "Generating TCS-Tailored Content..."
                : "Generate Content"}
            </AppleButton>
            {loading && (
              <Box sx={{ mt: 4 }}>
                <LinearProgress
                  color="secondary"
                  sx={{ height: 5, borderRadius: 3 }}
                />
                <Typography
                  sx={{
                    fontSize: "1rem",
                    mt: 2,
                    color: theme.palette.text.secondary,
                    textAlign: "center",
                  }}
                >
                  Personalizing content with your TCS profile details...
                </Typography>
              </Box>
            )}
          </Box>
          {error && (
            <Alert
              severity="error"
              sx={{
                mt: 4,
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(239,68,68,0.2)",
              }}
            >
              {error}
            </Alert>
          )}
          {response && !loading && (
            <Box sx={{ mt: 6 }}>
              <DisclaimerTypography sx={{ textAlign: "left" }}>
                This AI-generated content is for{" "}
                <strong>internal TCS use and educational purposes</strong> only.
                Always <strong>review, customize, and align</strong> it with
                your personal experiences and TCS guidelines before use.
                Sections in [brackets] are placeholders—replace with your
                specific details. For confidentiality, do not share sensitive
                TCS information.
              </DisclaimerTypography>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 3,
                  flexWrap: isMobile ? "wrap" : "nowrap",
                }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    fontSize: "1.25rem",
                    color: theme.palette.primary.dark,
                    textAlign: "left",
                  }}
                >
                  {selectedCategory}
                </Typography>
                <Box sx={{ display: "flex", gap: 2 }}>
                  <IconButton
                    onClick={handleCopy}
                    aria-label="Copy generated content"
                    sx={{ color: theme.palette.secondary.main }}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </IconButton>
                  <IconButton
                    onClick={handleDownload}
                    aria-label="Download generated content"
                    sx={{ color: theme.palette.success.main }}
                  >
                    {downloaded ? <CheckIcon /> : <DownloadIcon />}
                  </IconButton>
                  <IconButton
                    onClick={handlePrint}
                    aria-label="Print generated content"
                    sx={{ color: theme.palette.text.secondary }}
                  >
                    <PrintIcon />
                  </IconButton>
                </Box>
              </Box>
              <AppleCard
                elevation={0}
                sx={{
                  p: 4,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: "16px",
                }}
              >
                <ResponseTypography
                  variant="body1"
                  ref={contentRef}
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(response),
                  }}
                />
              </AppleCard>
              <Box sx={{ mt: 5, textAlign: "center" }}>
                <AppleButton
                  onClick={handleRegenerate}
                  disabled={loading || regenerationCount >= 2}
                  endIcon={<RegenerateIcon />}
                  aria-label="Generate alternative response"
                  color="secondary"
                >
                  Generate Alternative Version ({regenerationCount}/2)
                </AppleButton>
              </Box>
            </Box>
          )}
        </AppleCard>
      </motion.div>
    );
  }
);

// TCSTipsSection Component (Explicit left alignment for all text)
const TCSTipsSection = () => {
  const theme = useTheme();
  const tips = [
    "Tailor your responses to highlight TCS values: Leading Change, Integrity, Respect for the Individual, Excellence, Learning & Sharing.",
    "For technical roles, emphasize experience with TCS tools like TCS BaNCS, TCS iON, or cloud migrations.",
    "Use the STAR method for behavioral questions to structure answers effectively.",
    "Always follow up post-interview to demonstrate enthusiasm and professionalism.",
    "Leverage internal TCS portals like Ultimatix for opportunity tracking.",
  ];

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      variants={containerVariants}
    >
      <TipsCard as={motion.div} variants={cardVariants} whileHover="hover">
        <motion.div variants={itemVariants}>
          <Typography
            variant="h5"
            sx={{
              mb: 3,
              color: theme.palette.primary.main,
              fontSize: "1.15rem",
              textAlign: "left", // Explicit left align
            }}
          >
            Quick TCS Interview Tips
          </Typography>
        </motion.div>
        <motion.ul
          variants={itemVariants}
          style={{ paddingLeft: "1.5rem", margin: 0, textAlign: "left" }} // Explicit left align
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {tips.map((tip, index) => (
            <motion.li
              key={index}
              variants={listItemVariants}
              custom={index}
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.9rem",
                textAlign: "left",
              }} // Explicit left align
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              {tip}
            </motion.li>
          ))}
        </motion.ul>
        <motion.div variants={itemVariants}>
          <Typography
            variant="body2"
            sx={{
              mt: 3,
              fontStyle: "italic",
              color: theme.palette.text.secondary,
              fontSize: "0.9rem",
              textAlign: "left", // Explicit left align
            }}
          >
            These tips are based on common TCS internal practices—adapt them to
            your experience.
          </Typography>
        </motion.div>
      </TipsCard>
    </motion.div>
  );
};

// Main Component with Portfolio-Style Layout (Improved with icons, dividers, and consistent styling)
const TCSinterviewAssistantAI = () => {
  const {
    formData,
    formErrors,
    handleInputChange,
    handleSkillsChange,
    handleSkillSubtopicsChange,
    skillsInputValue,
    setSkillsInputValue,
    selectedSkills,
    handleNext,
    handleClear,
    confirmClear,
    clearModalOpen,
    setClearModalOpen,
    handleGenerate,
    showCategories,
    selectedCategory,
    setSelectedCategory,
    response,
    loading,
    error,
    setError,
  } = useInterviewAssistant();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const handleKeyPress = (event) => {
    if (event.key === "Enter" && !showCategories) handleNext();
  };

  const availableSubtopics = useMemo(() => {
    const allSubtopics = [];
    selectedSkills.forEach((skill) => {
      if (skillCategories[skill]) {
        allSubtopics.push(...skillCategories[skill]);
      }
    });
    return [...new Set(allSubtopics)];
  }, [selectedSkills]);

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          minHeight: "100vh",
          background: theme.palette.background.default,
          p: { xs: 3, md: 5 },
          maxWidth: "1600px",
          mx: "auto",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-start",
              flexDirection: isMobile ? "column" : "row",
              mb: 5,
              gap: 3,
              textAlign: isMobile ? "center" : "left",
            }}
          >
            <motion.img
              src={logo}
              alt="TCS Logo"
              sx={{
                width: { xs: "20px", md: "30px" },
                height: { xs: "20px", md: "30px" },
                borderRadius: "50%",
                objectFit: "cover",
                order: isMobile ? 2 : 1,
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              whileHover={{ scale: 1.1, transition: { duration: 0.3 } }}
            />
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "2.5rem", md: "4rem" },
                background: "linear-gradient(90deg, #0A84FF, #FF2D55)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                textShadow: "0 2px 6px rgba(0,0,0,0.1)",
                order: isMobile ? 1 : 2,
                flexGrow: 1,
              }}
            >
              Ultimate TCS AI Career Assistant:
              <br />
              <span style={{ fontSize: "40%", fontStyle: "italic" }}>
                (TCS AI Hackathon 2025)
              </span>
            </Typography>
          </Box>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.8 }}
        >
          <Typography
            variant="body1"
            sx={{
              fontSize: { xs: "1rem", md: "1.25rem" },
              maxWidth: "1000px",
              mx: "auto",
              mt: 4,
              lineHeight: 1.7,
              color: theme.palette.text.secondary,
              textAlign: "center",
            }}
          >
            Empowering TCS employees with AI-driven tools for internal
            opportunities, interview preparation, career progression, and
            professional communications—tailored to TCS's dynamic environment.
          </Typography>
        </motion.div>

        {/* Employee Details as Portfolio Card - Matched styling to Build section, left aligned, used List for skills with icons */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
        >
          <AppleCard sx={{ mt: 5 }}>
            <Typography
              variant="h3"
              sx={{
                fontSize: "1.75rem",
                mb: 4,
                color: theme.palette.primary.dark,
                textAlign: "left", // Explicit left align to match
              }}
              role="heading"
              aria-level="2"
            >
              Professional Portfolio Overview
            </Typography>
            <List disablePadding sx={{ textAlign: "left" }}>
              {" "}
              {/* Explicit left align */}
              <ListItem disablePadding>
                <ListItemIcon>
                  <Person color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Employee Name: Vinay Kumar Tiwari"
                  primaryTypographyProps={{ fontWeight: "bold" }}
                />
              </ListItem>
              <Divider sx={{ my: 1 }} />
              <ListItem disablePadding>
                <ListItemIcon>
                  <IdIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Employee ID: 2412328"
                  primaryTypographyProps={{ fontWeight: "bold" }}
                />
              </ListItem>
              <Divider sx={{ my: 1 }} />
              <ListItem disablePadding>
                <ListItemIcon>
                  <EmailIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Email ID: vinay.tiwari3@tcs.com"
                  primaryTypographyProps={{ fontWeight: "bold" }}
                />
              </ListItem>
              <Divider sx={{ my: 1 }} />
              <ListItem disablePadding>
                <ListItemIcon>
                  <SkillsIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Primary Skills:"
                  primaryTypographyProps={{ fontWeight: "bold" }}
                />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• SAP CAPM" />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• Node.js" />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• JavaScript" />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• FIORI" />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• SAP UI5" />
              </ListItem>
              <Divider sx={{ my: 1 }} />
              <ListItem disablePadding>
                <ListItemIcon>
                  <SkillsIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Secondary Skills:"
                  primaryTypographyProps={{ fontWeight: "bold" }}
                />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• Generative AI (GenAI) – Proficient in utilizing advanced GenAI platforms such as ChatGPT-5, Grok-4, Google Gemini, and Claude.ai to architect, design, and deliver innovative solutions across a wide range of technologies." />
              </ListItem>
              <ListItem disablePadding sx={{ pl: 4 }}>
                <ListItemText primary="• Ability to adapt and build end-to-end applications in any technology stack using GenAI-driven development." />
              </ListItem>
            </List>
          </AppleCard>
        </motion.div>

        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileHover="hover"
        >
          <AppleCard sx={{ mt: 5 }}>
            <Typography
              variant="h3"
              sx={{
                fontSize: "1.75rem",
                mb: 4,
                color: theme.palette.primary.dark,
                textAlign: "left", // Explicit left align
              }}
              role="heading"
              aria-level="2"
            >
              Build Your Professional Profile
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mb: 4,
                color: theme.palette.text.secondary,
                textAlign: "left",
              }}
            >
              Enter your details to personalize AI-generated content for TCS
              internal applications and interviews.
            </Typography>
            {error && (
              <Alert
                severity="error"
                sx={{ mb: 4, borderRadius: "8px" }}
                onClose={() => setError(null)}
              >
                {error}
              </Alert>
            )}
            <Grid container spacing={4} onKeyPress={handleKeyPress}>
              <Grid item xs={12} md={6}>
                <AppleTextField
                  fullWidth
                  label="Full Name"
                  value={formData.employeeName}
                  onChange={handleInputChange("employeeName")}
                  error={!!formErrors.employeeName}
                  helperText={formErrors.employeeName}
                  InputProps={{
                    startAdornment: (
                      <Person
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    ),
                  }}
                  required
                  aria-label="Full Name"
                  aria-invalid={!!formErrors.employeeName}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.yearsOfExperience}>
                  <InputLabel id="experience-label">
                    Experience Level
                  </InputLabel>
                  <AppleSelect
                    labelId="experience-label"
                    value={formData.yearsOfExperience}
                    onChange={handleInputChange("yearsOfExperience")}
                    label="Experience Level"
                    helperText={formErrors.yearsOfExperience}
                    startAdornment={
                      <Work sx={{ mr: 1, color: theme.palette.primary.main }} />
                    }
                    aria-label="Experience Level"
                    aria-invalid={!!formErrors.yearsOfExperience}
                  >
                    {experienceOptions.map((exp) => (
                      <MenuItem key={exp} value={exp}>
                        {exp}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <AppleTextField
                  fullWidth
                  label="Organization"
                  value={formData.companyName}
                  InputProps={{
                    readOnly: true,
                    startAdornment: (
                      <Business
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    ),
                  }}
                  aria-label="Organization"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.grade}>
                  <InputLabel id="grade-label">Current Grade</InputLabel>
                  <AppleSelect
                    labelId="grade-label"
                    value={formData.grade}
                    onChange={handleInputChange("grade")}
                    label="Current Grade"
                    helperText={formErrors.grade}
                    startAdornment={
                      <Work sx={{ mr: 1, color: theme.palette.primary.main }} />
                    }
                    aria-label="Current Grade"
                    aria-invalid={!!formErrors.grade}
                  >
                    {gradeOptions.map((grade) => (
                      <MenuItem key={grade} value={grade}>
                        {grade}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <AppleTextField
                  fullWidth
                  label="Target Position"
                  value={formData.jobPosition}
                  onChange={handleInputChange("jobPosition")}
                  error={!!formErrors.jobPosition}
                  helperText={formErrors.jobPosition}
                  InputProps={{
                    startAdornment: (
                      <Work sx={{ mr: 1, color: theme.palette.primary.main }} />
                    ),
                  }}
                  required
                  aria-label="Target Position"
                  aria-invalid={!!formErrors.jobPosition}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.jobLocation}>
                  <InputLabel id="location-label">
                    Preferred Location
                  </InputLabel>
                  <AppleSelect
                    labelId="location-label"
                    value={formData.jobLocation}
                    onChange={handleInputChange("jobLocation")}
                    label="Preferred Location"
                    helperText={formErrors.jobLocation}
                    startAdornment={
                      <LocationOn
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Preferred Location"
                    aria-invalid={!!formErrors.jobLocation}
                  >
                    {tcsCities.map((city) => (
                      <MenuItem key={city} value={city}>
                        {city}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>

              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={Object.keys(skillCategories)}
                  value={selectedSkills}
                  onChange={handleSkillsChange}
                  inputValue={skillsInputValue}
                  onInputChange={(event, newInputValue) => {
                    setSkillsInputValue(newInputValue);
                  }}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                        size="small"
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <AppleTextField
                      {...params}
                      label="Key Skills"
                      placeholder="e.g., Java, Microservices, SAP"
                      error={!!formErrors.skills}
                      helperText={formErrors.skills}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <>
                            <Work
                              sx={{
                                mr: 1,
                                color: theme.palette.primary.main,
                              }}
                            />
                            {params.InputProps.startAdornment}
                          </>
                        ),
                      }}
                      required
                      aria-label="Key Skills"
                      aria-invalid={!!formErrors.skills}
                    />
                  )}
                  sx={{ width: "100%" }}
                />
              </Grid>
              {selectedSkills.length > 0 && (
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    options={availableSubtopics}
                    value={formData.skillSubtopics}
                    onChange={handleSkillSubtopicsChange}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option}
                          {...getTagProps({ index })}
                          size="small"
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <AppleTextField
                        {...params}
                        label="Skill Subtopics"
                        placeholder="e.g., Spring Boot, AWS, JUnit"
                        error={!!formErrors.skillSubtopics}
                        helperText={formErrors.skillSubtopics}
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <>
                              <Work
                                sx={{
                                  mr: 1,
                                  color: theme.palette.primary.main,
                                }}
                              />
                              {params.InputProps.startAdornment}
                            </>
                          ),
                        }}
                        required
                        aria-label="Skill Subtopics"
                        aria-invalid={!!formErrors.skillSubtopics}
                      />
                    )}
                    sx={{ width: "100%" }}
                  />
                </Grid>
              )}

              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.interviewType}>
                  <InputLabel id="interview-type-label">
                    Interview Stage
                  </InputLabel>
                  <AppleSelect
                    labelId="interview-type-label"
                    value={formData.interviewType}
                    onChange={handleInputChange("interviewType")}
                    label="Interview Stage"
                    helperText={formErrors.interviewType}
                    startAdornment={
                      <Category
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Interview Stage"
                    aria-invalid={!!formErrors.interviewType}
                  >
                    {interviewTypes.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.communicationType}>
                  <InputLabel id="communication-type-label">
                    Communication Purpose
                  </InputLabel>
                  <AppleSelect
                    labelId="communication-type-label"
                    value={formData.communicationType}
                    onChange={handleInputChange("communicationType")}
                    label="Communication Purpose"
                    helperText={formErrors.communicationType}
                    startAdornment={
                      <Category
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Communication Purpose"
                    aria-invalid={!!formErrors.communicationType}
                  >
                    {communicationTypes.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl
                  fullWidth
                  error={!!formErrors.managerialExpectationFocus}
                >
                  <InputLabel id="managerial-focus-label">
                    Career Focus Area
                  </InputLabel>
                  <AppleSelect
                    labelId="managerial-focus-label"
                    value={formData.managerialExpectationFocus}
                    onChange={handleInputChange("managerialExpectationFocus")}
                    label="Career Focus Area"
                    helperText={formErrors.managerialExpectationFocus}
                    startAdornment={
                      <Work sx={{ mr: 1, color: theme.palette.primary.main }} />
                    }
                    aria-label="Career Focus Area"
                    aria-invalid={!!formErrors.managerialExpectationFocus}
                  >
                    {managerialExpectationFocuses.map((focus) => (
                      <MenuItem key={focus} value={focus}>
                        {focus}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl
                  fullWidth
                  error={!!formErrors.interviewQuestionType}
                >
                  <InputLabel id="question-type-label">
                    Question Focus
                  </InputLabel>
                  <AppleSelect
                    labelId="question-type-label"
                    value={formData.interviewQuestionType}
                    onChange={handleInputChange("interviewQuestionType")}
                    label="Question Focus"
                    helperText={formErrors.interviewQuestionType}
                    startAdornment={
                      <Category
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Question Focus"
                    aria-invalid={!!formErrors.interviewQuestionType}
                  >
                    {interviewQuestionTypes.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.tone}>
                  <InputLabel id="tone-label">Communication Tone</InputLabel>
                  <AppleSelect
                    labelId="tone-label"
                    value={formData.tone}
                    onChange={handleInputChange("tone")}
                    label="Communication Tone"
                    helperText={formErrors.tone}
                    startAdornment={
                      <Category
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Communication Tone"
                    aria-invalid={!!formErrors.tone}
                  >
                    {tones.map((toneOption) => (
                      <MenuItem key={toneOption} value={toneOption}>
                        {toneOption}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.feedbackType}>
                  <InputLabel id="feedback-type-label">
                    Feedback Context
                  </InputLabel>
                  <AppleSelect
                    labelId="feedback-type-label"
                    value={formData.feedbackType}
                    onChange={handleInputChange("feedbackType")}
                    label="Feedback Context"
                    helperText={formErrors.feedbackType}
                    startAdornment={
                      <Category
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    }
                    aria-label="Feedback Context"
                    aria-invalid={!!formErrors.feedbackType}
                  >
                    {feedbackTypes.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </AppleSelect>
                </FormControl>
              </Grid>

              <Grid item xs={12}>
                <AppleTextField
                  fullWidth
                  label="LinkedIn Profile (Optional)"
                  value={formData.linkedinUrl}
                  onChange={handleInputChange("linkedinUrl")}
                  error={!!formErrors.linkedinUrl}
                  helperText={formErrors.linkedinUrl}
                  InputProps={{
                    startAdornment: (
                      <LinkedIn
                        sx={{ mr: 1, color: theme.palette.primary.main }}
                      />
                    ),
                  }}
                  aria-label="LinkedIn Profile URL"
                  aria-invalid={!!formErrors.linkedinUrl}
                />
              </Grid>

              <Grid
                item
                xs={12}
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 3,
                  mt: 3,
                }}
              >
                <AppleButton
                  onClick={handleNext}
                  endIcon={<ArrowForward />}
                  aria-label="Proceed to AI tools"
                  size="large"
                >
                  Unlock AI Tools
                </AppleButton>
                <AppleClearButton
                  onClick={handleClear}
                  endIcon={<Refresh />}
                  aria-label="Reset profile"
                  size="large"
                >
                  Reset Profile
                </AppleClearButton>
              </Grid>
            </Grid>
          </AppleCard>
        </motion.div>

        <PreparationTools
          showCategories={showCategories}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          handleGenerate={handleGenerate}
          response={response}
          loading={loading}
          error={error}
          setError={setError}
        />

        {!showCategories && <TCSTipsSection />}

        <Modal
          open={clearModalOpen}
          onClose={() => setClearModalOpen(false)}
          closeAfterTransition
        >
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: { xs: 340, sm: 440 },
              background: "rgba(255, 255, 255, 0.98)",
              backdropFilter: "blur(20px)",
              borderRadius: "16px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
              p: 5,
              textAlign: "center",
            }}
          >
            <Typography
              variant="h6"
              sx={{
                fontWeight: 600,
                mb: 4,
                fontSize: "1.25rem",
                color: theme.palette.primary.dark,
              }}
            >
              Reset Profile?
            </Typography>
            <Typography
              sx={{
                mb: 5,
                fontSize: "1rem",
                lineHeight: 1.7,
                color: theme.palette.text.secondary,
              }}
            >
              Are you sure you want to reset all fields? Your saved profile will
              be cleared.
            </Typography>
            <Box sx={{ display: "flex", gap: 3, justifyContent: "center" }}>
              <AppleClearButton
                onClick={() => setClearModalOpen(false)}
                size="large"
              >
                Cancel
              </AppleClearButton>
              <AppleButton onClick={confirmClear} size="large">
                Reset
              </AppleButton>
            </Box>
          </Box>
        </Modal>

        <Box
          sx={{
            mt: 7,
            py: 4,
            textAlign: "center",
            backgroundColor: "rgba(0,0,0,0.05)",
            borderRadius: "16px",
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: theme.palette.text.secondary }}
          >
            © 2025 TCS AI Career Assistant | For internal use only | Generated
            content is AI-assisted and should be reviewed for accuracy.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default TCSinterviewAssistantAI;
