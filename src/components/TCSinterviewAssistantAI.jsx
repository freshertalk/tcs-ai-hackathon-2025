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
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  styled,
  Modal,
  Tooltip,
  IconButton,
  LinearProgress,
  ThemeProvider,
  createTheme,
  Autocomplete,
  Chip,
  useMediaQuery,
  useTheme,
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
  ExpandMore as ExpandMoreIcon,
  Autorenew as RegenerateIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Info as InfoIcon,
  Share as ShareIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
} from "@mui/icons-material";
import { motion } from "framer-motion"; // Added framer-motion for stunning animations
import logo from "../assets/tcs-logo.png"; // Logo import path fixed as specified
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import { Helmet } from "react-helmet";
import ReactGA from "react-ga";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RateLimiterMemory } from "rate-limiter-flexible";
import DOMPurify from "dompurify";
import { useNavigate } from "react-router-dom";
import { delay } from "lodash";

// Animation Variants (enhanced for ultimate framer-motion effects: softer, smoother, stunning)
const containerVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }, // Softer cubic-bezier for smoothness
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, x: -10 },
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }, // Staggered, smoother entry
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
      delay: i * 0.1, // Stunning staggered animation for list items
    },
  }),
};

// Enhanced Theme Definition with softer, smoother aesthetics and smaller fonts
const theme = createTheme({
  palette: {
    primary: { main: "#0A84FF", dark: "#0066CC" },
    secondary: { main: "#FF2D55" },
    background: {
      default: "linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)", // Softer gradient
      paper: "rgba(255, 255, 255, 0.95)",
    },
    text: { primary: "#1E293B", secondary: "#64748B" }, // Softer text colors
    error: { main: "#EF4444" },
    warning: { main: "#F59E0B" },
  },
  typography: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", // Explicit Inter with fallbacks
    h1: { fontWeight: 700, letterSpacing: "-0.02em", fontSize: "2.5rem" }, // Smaller
    h2: { fontWeight: 600, fontSize: "1.8rem" }, // Added for new sections
    h3: { fontWeight: 600, fontSize: "1.4rem" }, // Smaller
    h4: { fontWeight: 600, fontSize: "1.2rem" }, // Smaller
    h5: { fontWeight: 500, fontSize: "1.1rem" }, // Smaller
    h6: { fontWeight: 500, fontSize: "1rem" }, // Added for subtitles
    body1: { lineHeight: 1.7, letterSpacing: "0.005em", fontSize: "0.95rem" }, // Smaller and softer line height
    body2: { fontSize: "0.85rem" }, // Smaller
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: "4px", // Less rounded
          textTransform: "none",
          fontWeight: 500, // Softer weight
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)", // Smoother transition
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)", // Softer shadow
          "&:hover": {
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
            transform: "translateY(-2px)", // Subtle lift
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: "4px", // Less rounded
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(12px)", // Softer blur
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)", // Softer shadow
            "& fieldset": { border: "none" },
            "&:hover": { boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)" },
          },
          "& .MuiInputBase-input": {
            fontSize: "0.85rem", // Smaller text
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: "4px", // Less rounded
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          "& fieldset": { border: "none" },
        },
        select: {
          fontSize: "0.85rem", // Smaller text
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: "4px", // Less rounded
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
            "& fieldset": { border: "none" },
            "& .MuiInputBase-input": {
              fontSize: "0.85rem", // Smaller text
            },
          },
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "0.85rem", // Smaller and softer text for dropdown items
          color: "#64748B", // Softer color
          padding: "8px 16px",
          "&.Mui-selected": {
            backgroundColor: "rgba(10, 132, 255, 0.08)",
          },
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: "8px", // Less rounded
          boxShadow: "0 1px 6px rgba(0, 0, 0, 0.04)", // Softer
          border: "none",
          "&:before": { display: "none" },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: "8px", // Less rounded
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.06)", // Softer shadow
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: "4px", // Less rounded for dropdown menu
        },
      },
    },
  },
});

// Google API Key (hardcoded for demo; use .env in production)
const API_KEY = "AIzaSyDpRy7IFEjMlB7lP0uoTLtZyFuopfmDg0Q";

// Google Generative AI Initialization
const genAI = new GoogleGenerativeAI(API_KEY);

// Rate Limiter Initialization
const rateLimiter = new RateLimiterMemory({ points: 15, duration: 60 });

// Query Client for Caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { cacheTime: 5 * 60 * 1000, staleTime: 5 * 60 * 1000 },
  },
});

// Styled Components updated with softer, smoother theme
const AppleCard = styled(Paper)(({ theme }) => ({
  background: theme.palette.background.paper,
  backdropFilter: "blur(16px)", // Softer blur
  borderRadius: "8px", // Less rounded
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.06)", // Softer shadow
  padding: theme.spacing(4),
  transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)", // Smoother
  "&:hover": {
    transform: "translateY(-4px)", // Softer lift
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.10)",
  },
  [theme.breakpoints.down("sm")]: { padding: theme.spacing(3) },
}));

const AppleButton = styled(Button)(({ theme }) => ({
  background: "linear-gradient(90deg, #0A84FF, #FF2D55)",
  color: "#FFFFFF",
  padding: theme.spacing(1.75, 5), // Slightly larger for better touch
  fontSize: "0.95rem", // Smaller
  boxShadow: "0 2px 8px rgba(10, 132, 255, 0.20)", // Softer
  borderRadius: "4px", // Less rounded
  "&:hover": {
    background: "linear-gradient(90deg, #0066CC, #CC2444)",
    transform: "translateY(-2px)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.20)",
  },
  "&:disabled": {
    background: "#F1F5F9",
    color: "#94A3B8",
    boxShadow: "none",
  },
}));

const AppleClearButton = styled(Button)(({ theme }) => ({
  background: "linear-gradient(145deg, #ffffff, #f8fafc)", // Softer gradient
  color: theme.palette.text.secondary,
  padding: theme.spacing(1.75, 5),
  fontSize: "0.95rem", // Smaller
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)", // Softer
  borderRadius: "4px", // Less rounded
  "&:hover": {
    background: "linear-gradient(90deg, #0A84FF, #FF2D55)",
    color: "#FFFFFF",
    transform: "translateY(-2px)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.20)",
  },
}));

const AppleTextField = styled(TextField)(({ theme }) => ({
  "& .MuiInputBase-input": {
    padding: theme.spacing(2),
    fontSize: "0.85rem", // Smaller
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", // Smoother
    "&:focus": { background: "rgba(255, 255, 255, 0.98)" },
  },
}));

const AppleSelect = styled(Select)(({ theme }) => ({
  "& .MuiSelect-select": {
    padding: theme.spacing(2),
    fontSize: "0.85rem", // Smaller
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    "&:focus": { background: "rgba(255, 255, 255, 0.98)" },
  },
  "& .MuiMenu-paper": {
    borderRadius: "4px", // Less rounded
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
  },
}));

const ResponseTypography = styled(Typography)(({ theme }) => ({
  textAlign: "justify",
  lineHeight: 1.8, // Softer spacing
  fontSize: "0.95rem", // Smaller
  color: theme.palette.text.primary,
  "& strong": { fontWeight: 600 }, // Softer bold
  "& em": { fontStyle: "italic" },
  "& p": { margin: "1rem 0" }, // Adjusted for professional spacing
  "& ol": {
    margin: "1rem 0",
    paddingLeft: "1.5rem",
  },
  "& li": { marginBottom: "0.5rem" },
  "& strong em": {
    backgroundColor: "#FEF3C7", // Softer highlight
    color: "#92400E",
    padding: "0.2rem 0.4rem",
    borderRadius: "6px",
    fontStyle: "italic",
  },
  // Ultra professional formatting for lists and paragraphs
  "& ul, & ol": {
    marginBottom: "1rem",
  },
  "& h2, & h3": {
    fontWeight: 600,
    marginTop: "1.5rem",
    marginBottom: "0.75rem",
    color: theme.palette.primary.main,
  },
}));

const DisclaimerTypography = styled(Typography)(({ theme }) => ({
  background: "linear-gradient(145deg, #ffffff, #f8fafc)", // Softer
  backdropFilter: "blur(12px)",
  padding: theme.spacing(2.5),
  borderRadius: "4px", // Less rounded
  marginBottom: theme.spacing(3),
  fontSize: "0.85rem", // Smaller
  color: theme.palette.text.secondary,
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)", // Softer
  "& strong": { fontWeight: 600, color: theme.palette.error.main },
}));

const TipsCard = styled(AppleCard)(({ theme }) => ({
  mt: 4,
  background: "linear-gradient(135deg, #E0F2FE 0%, #F0F9FF 100%)",
  border: `1px solid ${theme.palette.primary.main}`,
}));

// Utility Functions (enhanced for better content handling)
const callGeminiAPI = async (prompt, sessionId, retries = 3) => {
  // Check if API key is set
  if (!API_KEY) {
    throw new Error(
      "API key is not set. Please ensure the API_KEY constant is defined with a valid key from Google AI Studio."
    );
  }

  let attempt = 0;
  while (attempt < retries) {
    try {
      await rateLimiter.consume(sessionId);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Switched to stable model
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

      // Ultra professional wrapping
      return `<div style="line-height: 1.8; text-align: justify; padding: 1.5rem; border-radius: 4px; background: #f8fafc; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">${text}</div>`;
    } catch (error) {
      attempt++;
      console.error(`Attempt ${attempt} failed:`, error);
      if (
        error.message.includes("rate limit") ||
        (error.status && error.status === 429)
      ) {
        throw new Error("Rate limit exceeded. Please try again in a minute.");
      } else if (
        error.message.includes("API key") ||
        (error.status && (error.status === 401 || error.status === 403))
      ) {
        throw new Error(
          "Invalid API key. Please check your credentials and ensure the Generative Language API is enabled in Google Cloud Console."
        );
      }
      if (attempt < retries) {
        await delay(1000 * attempt);
      } else {
        throw new Error(
          "Failed to generate response after retries. Please try again later."
        );
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

// Enhanced lists for dropdowns with more TCS-specific options
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

const gradeOptions = ["C2", "C3A", "C3B", "C4"];

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

// Enhanced Skill categories for dynamic suggestions with more TCS-relevant skills
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

// Custom Hook: useInterviewAssistant (enhanced with better validation and state management)
const useInterviewAssistant = () => {
  const sessionId = useMemo(() => Math.random().toString(36).substring(2), []);
  const initialFormData = useMemo(() => {
    const savedData = localStorage.getItem("tcsInterviewAssistantFormData"); // Renamed key for specificity
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
  const [wikiData, setWikiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [skillsInputValue, setSkillsInputValue] = useState("");
  const [selectedSkills, setSelectedSkills] = useState(
    initialFormData.skills || []
  );

  // Update derived fields if needed
  useEffect(() => {
    setFormData((prev) => ({ ...prev }));
  }, []);

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
      // Real-time validation on change
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
        // Skip fixed and optional
        const error = validateField(key, value);
        if (error) errors[key] = error;
      }
    });

    setFormErrors(errors);

    if (Object.keys(errors).length === 0) {
      setError(null);
      setShowCategories(true);
      ReactGA.event({
        category: "Form",
        action: "Proceed to AI Tools",
      });
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
    setWikiData(null);
    setError(null);
    setClearModalOpen(false);
    localStorage.removeItem("tcsInterviewAssistantFormData");
    ReactGA.event({ category: "Form", action: "Clear Form" });
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse("");
    setWikiData(null);
    try {
      const prompt = generatePrompt(selectedCategory, formData);
      if (prompt) {
        const aiResponse = await callGeminiAPI(prompt, sessionId);
        setResponse(aiResponse);
      }
      ReactGA.event({
        category: "Content",
        action: "Generate Content",
        label: selectedCategory,
      });
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
    wikiData,
    loading,
    error,
    setError,
  };
};

// Enhanced Component: PreparationTools with fixed email, added download, and better UX
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
    const [shareTooltip, setShareTooltip] = useState("");
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
          ReactGA.event({
            category: "Content",
            action: "Copy Content",
            label: selectedCategory,
          });
        })
        .catch(() => {
          // Fallback for older browsers
          const textArea = document.createElement("textarea");
          textArea.value = content;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
    }, [response, selectedCategory]);

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
      ReactGA.event({
        category: "Content",
        action: "Download Content",
        label: selectedCategory,
      });
    }, [response, selectedCategory]);

    const handleShare = useCallback(async () => {
      if (navigator.share) {
        const shareData = {
          title: `TCS AI Interview Assistant - ${selectedCategory}`,
          text: `${selectedCategory} generated for TCS internal opportunities. ${convertHtmlToText(
            response
          ).substring(0, 100)}...`,
          url: window.location.href,
        };
        try {
          await navigator.share(shareData);
          ReactGA.event({
            category: "Content",
            action: "Share Native",
            label: selectedCategory,
          });
        } catch (err) {
          console.log("Share failed", err);
        }
      } else {
        // Fallback: Open social media links
        setShareTooltip("Opened Twitter share dialog");
        const shareUrl = window.location.href;
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          `TCS AI Assistant generated ${selectedCategory}: ${convertHtmlToText(
            response
          ).substring(0, 100)}... Check it out!`
        )}&url=${encodeURIComponent(shareUrl)}`;
        window.open(twitterUrl, "_blank");
        setTimeout(() => setShareTooltip(""), 2000);
        ReactGA.event({
          category: "Content",
          action: "Share Social Fallback",
          label: selectedCategory,
        });
      }
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
              em { font-style: italic; }
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
      ReactGA.event({
        category: "Content",
        action: "Print Content",
        label: selectedCategory,
      });
    }, [response, selectedCategory]);

    const handleRetry = () => {
      handleGenerate();
    };

    const handleRegenerate = () => {
      if (regenerationCount < 2) {
        // Increased limit for better UX
        handleGenerate();
        setRegenerationCount((prev) => prev + 1);
      }
    };

    if (!showCategories) return null;

    return (
      <AppleCard>
        <Typography
          variant="h3"
          sx={{ fontSize: "1.4rem", mb: 3, color: theme.palette.primary.main }}
          role="heading"
          aria-level="2"
        >
          AI-Powered Content Generation Tools
        </Typography>
        <Typography
          variant="body2"
          sx={{ mb: 2, color: theme.palette.text.secondary }}
        >
          Select a category below to generate tailored, TCS-specific content for
          your internal career advancement.
        </Typography>
        <FormControl fullWidth>
          <InputLabel id="prep-category-label">
            Content Generation Category
          </InputLabel>
          <Tooltip
            title="Choose a category to generate personalized, professional content aligned with TCS standards"
            arrow
          >
            <AppleSelect
              labelId="prep-category-label"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              label="Content Generation Category"
              startAdornment={
                <Tooltip title="Category Selection" arrow>
                  <Category
                    sx={{ mr: 1, color: theme.palette.secondary.main }}
                  />
                </Tooltip>
              }
              aria-label="Select content generation category"
            >
              {preparationCategories.map((cat) => (
                <MenuItem key={cat} value={cat}>
                  {cat}
                </MenuItem>
              ))}
            </AppleSelect>
          </Tooltip>
        </FormControl>
        <Box sx={{ mt: 4, textAlign: "center" }}>
          <Tooltip
            title="Generate customized content based on your profile"
            arrow
          >
            <AppleButton
              onClick={handleGenerate}
              disabled={!selectedCategory || loading}
              endIcon={
                <Tooltip title="Generate" arrow>
                  <ArrowForward />
                </Tooltip>
              }
              aria-label="Generate personalized content"
              size="large"
            >
              {loading
                ? "Generating TCS-Tailored Content..."
                : "Generate Content"}
            </AppleButton>
          </Tooltip>
          {loading && (
            <Box sx={{ mt: 3 }}>
              <LinearProgress
                color="secondary"
                sx={{ height: 4, borderRadius: 2 }}
              />
              <Typography
                sx={{
                  fontSize: "0.9rem",
                  mt: 1,
                  color: theme.palette.text.secondary,
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
              mt: 3,
              borderRadius: "4px",
              boxShadow: "0 2px 8px rgba(239,68,68,0.15)",
            }}
            action={
              <AppleButton size="small" onClick={handleRetry} color="error">
                Retry Generation
              </AppleButton>
            }
          >
            {error}
          </Alert>
        )}
        {response && !loading && (
          <Box sx={{ mt: 5 }}>
            <DisclaimerTypography>
              This AI-generated content is for{" "}
              <strong>internal TCS use and educational purposes</strong> only.
              Always <strong>review, customize, and align</strong> it with your
              personal experiences and TCS guidelines before use. Sections in
              [brackets] are placeholders—replace with your specific details.
              For confidentiality, do not share sensitive TCS information.
            </DisclaimerTypography>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 2.5,
                flexWrap: isMobile ? "wrap" : "nowrap",
              }}
            >
              <Typography
                variant="h4"
                sx={{ fontSize: "1.2rem", color: theme.palette.primary.dark }}
              >
                {selectedCategory}
              </Typography>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Tooltip
                  title={
                    copied
                      ? "Copied to Clipboard!"
                      : "Copy Content to Clipboard"
                  }
                  arrow
                >
                  <IconButton
                    onClick={handleCopy}
                    aria-label="Copy generated content"
                    sx={{ color: theme.palette.secondary.main }}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title={shareTooltip || "Share on Social Media (Twitter/X)"}
                  arrow
                >
                  <IconButton
                    onClick={handleShare}
                    onMouseEnter={() => setShareTooltip("")}
                    aria-label="Share on social media"
                    sx={{ color: theme.palette.warning.main }}
                  >
                    <ShareIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title={downloaded ? "Downloaded!" : "Download as TXT File"}
                  arrow
                >
                  <IconButton
                    onClick={handleDownload}
                    aria-label="Download generated content"
                    sx={{ color: theme.palette.success.main }}
                  >
                    {downloaded ? <CheckIcon /> : <DownloadIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Print Content for Review" arrow>
                  <IconButton
                    onClick={handlePrint}
                    aria-label="Print generated content"
                    sx={{ color: theme.palette.text.secondary }}
                  >
                    <PrintIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title="Placeholders like [brackets] need your personal TCS-specific details (highlighted for easy editing)"
                  arrow
                >
                  <IconButton
                    aria-label="Editing guidelines"
                    sx={{ color: theme.palette.warning.main }}
                  >
                    <InfoIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <AppleCard
              elevation={0}
              sx={{
                p: 3.5,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: "8px",
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
            <Box sx={{ mt: 4, textAlign: "center" }}>
              <Tooltip
                title={
                  regenerationCount >= 2
                    ? "Daily regeneration limit reached—try again tomorrow for fresh insights"
                    : "Generate a varied response for more options"
                }
                arrow
              >
                <span>
                  <AppleButton
                    onClick={handleRegenerate}
                    disabled={loading || regenerationCount >= 2}
                    endIcon={
                      <Tooltip title="Regenerate" arrow>
                        <RegenerateIcon />
                      </Tooltip>
                    }
                    aria-label="Generate alternative response"
                    color="secondary"
                  >
                    Generate Alternative Version ({regenerationCount}/2)
                  </AppleButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
        )}
      </AppleCard>
    );
  }
);

// Enhanced Tips Section Component with left alignment, smaller fonts, and framer-motion animations
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
      <TipsCard sx={{ textAlign: "left" }}>
        <motion.div variants={itemVariants}>
          <Typography
            variant="h5"
            sx={{ mb: 2, color: theme.palette.primary.main, fontSize: "1rem" }} // Smaller font for title
          >
            Quick TCS Interview Tips
          </Typography>
        </motion.div>
        <motion.ul
          variants={itemVariants}
          style={{ paddingLeft: "1.5rem", margin: 0 }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {tips.map((tip, index) => (
            <motion.li
              key={index}
              variants={listItemVariants}
              custom={index}
              style={{ marginBottom: "0.5rem", fontSize: "0.8rem" }} // Smaller text fonts for tips
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
              mt: 2,
              fontStyle: "italic",
              color: theme.palette.text.secondary,
              fontSize: "0.8rem",
            }} // Smaller font
          >
            These tips are based on common TCS internal practices—adapt them to
            your experience.
          </Typography>
        </motion.div>
      </TipsCard>
    </motion.div>
  );
};

// Main Component: TCSinterviewAssistantAI enhanced as ultimate tool
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
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  useEffect(() => {
    // Initialize Google Analytics with a dummy ID for demo (replace with real in production)
    ReactGA.initialize("UA-123456-1");
    ReactGA.pageview(window.location.pathname + window.location.search);
  }, []);

  const handleKeyPress = (event) => {
    if (event.key === "Enter" && !showCategories) handleNext();
  };

  // Dynamic subtopics based on selected skills
  const availableSubtopics = useMemo(() => {
    const allSubtopics = [];
    selectedSkills.forEach((skill) => {
      if (skillCategories[skill]) {
        allSubtopics.push(...skillCategories[skill]);
      }
    });
    return [...new Set(allSubtopics)]; // Unique
  }, [selectedSkills]);

  return (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <Box
          sx={{
            minHeight: "100vh",
            background: theme.palette.background.default,
            p: { xs: 2.5, md: 4 }, // Softer padding
            maxWidth: "1400px",
            mx: "auto",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <Helmet>
            <title>
              Ultimate TCS AI Interview & Career Assistant - Empowering Internal
              Growth
            </title>
            <meta
              name="description"
              content="The ultimate AI-powered tool for TCS employees: Generate cover letters, emails, interview questions, and more for internal projects, promotions, and career progression."
            />
            <meta
              name="keywords"
              content="TCS internal interview preparation, AI career assistant TCS, TCS promotion emails, behavioral questions TCS, technical prep TCS, salary negotiation TCS"
            />
            <meta name="robots" content="index, follow" />
            <link rel="canonical" href="https://freshertalk.in/tcs-ai-vinay" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            {/* Ensure Inter font is loaded */}
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link
              rel="preconnect"
              href="https://fonts.gstatic.com"
              crossorigin
            />
            <link
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
              rel="stylesheet"
            />
          </Helmet>

          {/* Updated layout: Logo before title on laptop (md+), stacked and centered on mobile */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-start",
              flexDirection: isMobile ? "column" : "row",
              mb: 4,
              gap: 2,
              textAlign: isMobile ? "center" : "left",
            }}
          >
            <motion.img
              src={logo}
              alt="TCS Logo"
              sx={{
                width: { xs: "15px", md: "25px" },
                height: { xs: "15px", md: "25px" },
                borderRadius: "50%",
                objectFit: "cover",
                order: isMobile ? 2 : 1,
              }}
              animate={{
                y: [0, -5, 0],
                rotate: [0, 2, -2, 0],
              }}
              transition={{
                y: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                rotate: { duration: 3, repeat: Infinity, ease: "easeInOut" },
              }}
              whileHover={{
                scale: 1.1,
                rotate: 360,
                transition: { duration: 0.6, ease: "easeInOut" },
              }}
            />
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "2.2rem", md: "3.5rem" }, // Smaller
                background: "linear-gradient(90deg, #0A84FF, #FF2D55)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                textShadow: "0 1px 3px rgba(0,0,0,0.08)", // Softer
                order: isMobile ? 1 : 2,
                flexGrow: 1,
              }}
            >
              Ultimate TCS AI Career Assistant:
              <br />
              <span style={{ fontSize: "35%", fontStyle: "italic" }}>
                (TCS AI Hackathon 2025)
              </span>
            </Typography>
          </Box>

          <Typography
            variant="body1"
            sx={{
              fontSize: { xs: "0.95rem", md: "1.2rem" }, // Smaller
              maxWidth: "900px",
              mx: "auto",
              mt: 3, // Added line space
              lineHeight: 1.6, // Softer
              color: theme.palette.text.secondary,
              textAlign: "center",
            }}
          >
            Empowering TCS employees with AI-driven tools for internal
            opportunities, interview preparation, career progression, and
            professional communications—tailored to TCS's dynamic environment.
          </Typography>

          <AppleCard>
            <Typography
              variant="h3"
              sx={{
                fontSize: "1.4rem", // Smaller
                mb: 3.5, // Softer
                color: theme.palette.primary.dark,
              }}
              role="heading"
              aria-level="2"
            >
              Build Your Professional Profile
            </Typography>
            <Typography
              variant="body2"
              sx={{ mb: 3, color: theme.palette.text.secondary }}
            >
              Enter your details to personalize AI-generated content for TCS
              internal applications and interviews.
            </Typography>
            {error && (
              <Alert
                severity="error"
                sx={{ mb: 3.5, borderRadius: "4px" }} // Less rounded
                onClose={() => setError(null)}
              >
                {error}
              </Alert>
            )}
            <Grid container spacing={3.5} onKeyPress={handleKeyPress}>
              {/* Basic Info - Aligned in pairs */}
              <Grid item xs={12} md={6}>
                <Tooltip title="Your full name for personalized content" arrow>
                  <AppleTextField
                    fullWidth
                    label="Full Name"
                    value={formData.employeeName}
                    onChange={handleInputChange("employeeName")}
                    error={!!formErrors.employeeName}
                    helperText={formErrors.employeeName}
                    InputProps={{
                      startAdornment: (
                        <Tooltip title="Full Name" arrow>
                          <Person
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
                      ),
                    }}
                    required
                    aria-label="Full Name"
                    aria-invalid={!!formErrors.employeeName}
                  />
                </Tooltip>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.yearsOfExperience}>
                  <InputLabel id="experience-label">
                    Experience Level
                  </InputLabel>
                  <Tooltip
                    title="Select your current experience level at TCS"
                    arrow
                  >
                    <AppleSelect
                      labelId="experience-label"
                      value={formData.yearsOfExperience}
                      onChange={handleInputChange("yearsOfExperience")}
                      label="Experience Level"
                      helperText={formErrors.yearsOfExperience}
                      startAdornment={
                        <Tooltip title="Experience Level" arrow>
                          <Work
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <Tooltip
                  title="Tata Consultancy Services (TCS) - Fixed for internal focus"
                  arrow
                >
                  <AppleTextField
                    fullWidth
                    label="Organization"
                    value={formData.companyName}
                    InputProps={{
                      readOnly: true,
                      startAdornment: (
                        <Tooltip title="Organization" arrow>
                          <Business
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
                      ),
                    }}
                    aria-label="Organization"
                  />
                </Tooltip>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.grade}>
                  <InputLabel id="grade-label">Current Grade</InputLabel>
                  <Tooltip
                    title="Your current TCS grade for progression context"
                    arrow
                  >
                    <AppleSelect
                      labelId="grade-label"
                      value={formData.grade}
                      onChange={handleInputChange("grade")}
                      label="Current Grade"
                      helperText={formErrors.grade}
                      startAdornment={
                        <Tooltip title="Grade" arrow>
                          <Work
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>

              {/* Job Details - Aligned in pairs */}
              <Grid item xs={12} md={6}>
                <Tooltip
                  title="Target internal position or project role at TCS"
                  arrow
                >
                  <AppleTextField
                    fullWidth
                    label="Target Position"
                    value={formData.jobPosition}
                    onChange={handleInputChange("jobPosition")}
                    error={!!formErrors.jobPosition}
                    helperText={formErrors.jobPosition}
                    InputProps={{
                      startAdornment: (
                        <Tooltip title="Target Position" arrow>
                          <Work
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
                      ),
                    }}
                    required
                    aria-label="Target Position"
                    aria-invalid={!!formErrors.jobPosition}
                  />
                </Tooltip>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.jobLocation}>
                  <InputLabel id="location-label">
                    Preferred Location
                  </InputLabel>
                  <Tooltip
                    title="TCS delivery center or hub for the opportunity"
                    arrow
                  >
                    <AppleSelect
                      labelId="location-label"
                      value={formData.jobLocation}
                      onChange={handleInputChange("jobLocation")}
                      label="Preferred Location"
                      helperText={formErrors.jobLocation}
                      startAdornment={
                        <Tooltip title="Location" arrow>
                          <LocationOn
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>

              {/* Skills Section - Aligned in pairs */}
              <Grid item xs={12} md={6}>
                <Tooltip
                  title="Core skills relevant to your TCS role and target position"
                  arrow
                >
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
                          size="small" // Smaller chips
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
                  />
                </Tooltip>
              </Grid>
              {selectedSkills.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Tooltip
                    title="Specific subtopics or technologies within your skills"
                    arrow
                  >
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
                    />
                  </Tooltip>
                </Grid>
              )}

              {/* Interview & Communication - Aligned in pairs */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.interviewType}>
                  <InputLabel id="interview-type-label">
                    Interview Stage
                  </InputLabel>
                  <Tooltip
                    title="Stage of the internal interview process"
                    arrow
                  >
                    <AppleSelect
                      labelId="interview-type-label"
                      value={formData.interviewType}
                      onChange={handleInputChange("interviewType")}
                      label="Interview Stage"
                      helperText={formErrors.interviewType}
                      startAdornment={
                        <Tooltip title="Interview Stage" arrow>
                          <Category
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.communicationType}>
                  <InputLabel id="communication-type-label">
                    Communication Purpose
                  </InputLabel>
                  <Tooltip
                    title="Type of communication or document needed"
                    arrow
                  >
                    <AppleSelect
                      labelId="communication-type-label"
                      value={formData.communicationType}
                      onChange={handleInputChange("communicationType")}
                      label="Communication Purpose"
                      helperText={formErrors.communicationType}
                      startAdornment={
                        <Tooltip title="Communication Purpose" arrow>
                          <Category
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
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
                  <Tooltip
                    title="Specific area of managerial or career expectation"
                    arrow
                  >
                    <AppleSelect
                      labelId="managerial-focus-label"
                      value={formData.managerialExpectationFocus}
                      onChange={handleInputChange("managerialExpectationFocus")}
                      label="Career Focus Area"
                      helperText={formErrors.managerialExpectationFocus}
                      startAdornment={
                        <Tooltip title="Career Focus" arrow>
                          <Work
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
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
                  <Tooltip title="Type of questions or content focus" arrow>
                    <AppleSelect
                      labelId="question-type-label"
                      value={formData.interviewQuestionType}
                      onChange={handleInputChange("interviewQuestionType")}
                      label="Question Focus"
                      helperText={formErrors.interviewQuestionType}
                      startAdornment={
                        <Tooltip title="Question Focus" arrow>
                          <Category
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.tone}>
                  <InputLabel id="tone-label">Communication Tone</InputLabel>
                  <Tooltip title="Desired tone for the generated content" arrow>
                    <AppleSelect
                      labelId="tone-label"
                      value={formData.tone}
                      onChange={handleInputChange("tone")}
                      label="Communication Tone"
                      helperText={formErrors.tone}
                      startAdornment={
                        <Tooltip title="Tone" arrow>
                          <Category
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!formErrors.feedbackType}>
                  <InputLabel id="feedback-type-label">
                    Feedback Context
                  </InputLabel>
                  <Tooltip title="Type of feedback or reflection needed" arrow>
                    <AppleSelect
                      labelId="feedback-type-label"
                      value={formData.feedbackType}
                      onChange={handleInputChange("feedbackType")}
                      label="Feedback Context"
                      helperText={formErrors.feedbackType}
                      startAdornment={
                        <Tooltip title="Feedback Context" arrow>
                          <Category
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
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
                  </Tooltip>
                </FormControl>
              </Grid>

              {/* Optional LinkedIn - Full width for better alignment */}
              <Grid item xs={12}>
                <Tooltip
                  title="Your LinkedIn URL (optional—for professional referencing in content)"
                  arrow
                >
                  <AppleTextField
                    fullWidth
                    label="LinkedIn Profile (Optional)"
                    value={formData.linkedinUrl}
                    onChange={handleInputChange("linkedinUrl")}
                    error={!!formErrors.linkedinUrl}
                    helperText={formErrors.linkedinUrl}
                    InputProps={{
                      startAdornment: (
                        <Tooltip title="LinkedIn Profile" arrow>
                          <LinkedIn
                            sx={{ mr: 1, color: theme.palette.primary.main }}
                          />
                        </Tooltip>
                      ),
                    }}
                    aria-label="LinkedIn Profile URL"
                    aria-invalid={!!formErrors.linkedinUrl}
                  />
                </Tooltip>
              </Grid>

              <Grid
                item
                xs={12}
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 2.5, // Softer gap
                  mt: 2,
                }}
              >
                <Tooltip title="Proceed to AI content generation" arrow>
                  <AppleButton
                    onClick={handleNext}
                    endIcon={
                      <Tooltip title="Proceed" arrow>
                        <ArrowForward />
                      </Tooltip>
                    }
                    aria-label="Proceed to AI tools"
                    size="large"
                  >
                    Unlock AI Tools
                  </AppleButton>
                </Tooltip>
                <Tooltip title="Reset all fields to start fresh" arrow>
                  <AppleClearButton
                    onClick={handleClear}
                    endIcon={
                      <Tooltip title="Reset" arrow>
                        <Refresh />
                      </Tooltip>
                    }
                    aria-label="Reset profile"
                    size="large"
                  >
                    Reset Profile
                  </AppleClearButton>
                </Tooltip>
              </Grid>
            </Grid>
          </AppleCard>

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
                width: { xs: 320, sm: 400 },
                background: "rgba(255, 255, 255, 0.98)",
                backdropFilter: "blur(16px)", // Softer
                borderRadius: "8px", // Less rounded
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)", // Softer
                p: 4.5, // Softer padding
                textAlign: "center",
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600, // Softer
                  mb: 3,
                  fontSize: "1.2rem", // Smaller
                  color: theme.palette.primary.dark,
                }}
              >
                Reset Profile?
              </Typography>
              <Typography
                sx={{
                  mb: 4,
                  fontSize: "0.95rem", // Smaller
                  lineHeight: 1.6, // Softer
                  color: theme.palette.text.secondary,
                }}
              >
                Are you sure you want to reset all fields? Your saved profile
                will be cleared.
              </Typography>
              <Box sx={{ display: "flex", gap: 2.5, justifyContent: "center" }}>
                <Tooltip title="Cancel reset" arrow>
                  <AppleClearButton
                    onClick={() => setClearModalOpen(false)}
                    size="large"
                  >
                    Cancel
                  </AppleClearButton>
                </Tooltip>
                <Tooltip title="Confirm reset" arrow>
                  <AppleButton onClick={confirmClear} size="large">
                    Reset
                  </AppleButton>
                </Tooltip>
              </Box>
            </Box>
          </Modal>

          {/* Footer Disclaimer */}
          <Box
            sx={{
              mt: 6,
              py: 3,
              textAlign: "center",
              backgroundColor: "rgba(0,0,0,0.03)",
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
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default TCSinterviewAssistantAI;
