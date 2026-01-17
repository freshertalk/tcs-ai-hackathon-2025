// src/TCSinterviewAssistantAI.jsx
// World-Class Portfolio Design
// Features: Premium animations, Certifications, Resume Download, Enhanced sections

import React, { useState, useEffect, memo } from "react";
import {
  Avatar,
  Box,
  Container,
  CssBaseline,
  Grid,
  IconButton,
  Stack,
  Typography,
  GlobalStyles,
  Chip,
  useMediaQuery,
  Link,
  Modal,
  Backdrop,
  Fade,
} from "@mui/material";
import {
  LinkedIn,
  MailOutline,
  ArrowForward,
  StarRounded,
  RocketLaunch,
  Code,
  EmojiObjectsOutlined,
  Menu as MenuIcon,
  Close as CloseIcon,
  GitHub,
  WhatsApp,
  LocationOn,
  Phone,
  WorkOutline,
  CalendarToday,
  Security,
  Cloud,
  Storage,
  IntegrationInstructions,
  VerifiedUser,
  School,
  Download,
  Visibility,
  PictureAsPdf,
} from "@mui/icons-material";
import { createTheme, ThemeProvider, alpha } from "@mui/material/styles";
import { motion, AnimatePresence } from "framer-motion";

// --- ASSETS ---
import logo from "../assets/logo.avif";
import photo from "../assets/v.avif";
import resumePDF from "../assets/Resume- VinayKumarTiwari.pdf";

/* =============================================================================
   DATA
============================================================================= */

const PROFILE_DATA = {
  name: "Vinay Tiwari",
  title:
    "Senior Software Developer (10+ yrs) — SAP UI5 / FIORI / CAPM / BTP / GenAI Engineer",
  currentRole: "SAP BTP/UI5/FIORI/CAP (Node.js) Consultant",
  email: "vinay.tiwari.sap@gmail.com",
  linkedin: "https://www.linkedin.com/in/vinay-tiwari-sap/",
  whatsapp: "https://wa.me/917392062233",
  whatsappNumber: "+91 73920 62233",
  github: "https://github.com/vinaytiwarisap",
  location: "Noida, India",
  summary:
    "Pragmatic engineer with 10+ years of IT experience, including 6+ years of deep specialization in SAP UI5 and Fiori development on SAP BTP, delivering scalable, secure SAP CAP services using Node.js, with GenAI integration (ChatGPT, Grok, Gemini, Claude.ai) applied where it delivers measurable business value.",
};

const CERTIFICATIONS_DATA = [
  {
    title: "SAP Certified Development Associate",
    subtitle: "SAP Fiori Application Developer",
    code: "C_FIORDEV_21",
    issuer: "SAP",
    color: "#0FAAFF",
  },
  {
    title: "SAP Certified Development Associate",
    subtitle: "SAP Extension Suite",
    code: "C_CPE_12",
    issuer: "SAP",
    color: "#0FAAFF",
  },
  {
    title: "IBM Certified Professional",
    subtitle: "Agile Explorer, Cognitive Practitioner & Design Thinking",
    code: "",
    issuer: "IBM",
    color: "#1F70C1",
  },
  {
    title: "Microservices Fundamentals",
    subtitle: "Cloud Native Architecture",
    code: "",
    issuer: "IBM (Coursera)",
    color: "#1F70C1",
  },
  {
    title: "PGDAC - Advanced Computing",
    subtitle: "6-Month Training Program",
    code: "",
    issuer: "CDAC Pune",
    color: "#FF6B35",
  },
];

const EXPERIENCE_DATA = [
  {
    company: "Tata Consultancy Services",
    role: "Assistant Consultant",
    period: "Aug 2022 — Jan 2026",
    location: "Bengaluru/Varanasi",
    description:
      "Leading digital transformation initiatives for Fortune 500 clients, architecting enterprise-grade SAP solutions with focus on security, scalability, and user experience.",
    items: [
      {
        title: "Digital Transformation Lead",
        client: "Major Pharma Industry · USA",
        time: "May 2024 — Present",
        type: "Team Lead",
        industry: "Healthcare",
        points: [
          "Architected and delivered Fiori-compliant UI5 applications on SAP BTP with real-time OData V4 integration",
          "Led rapid prototyping initiatives with bi-weekly sprint demos to C-level stakeholders",
          "Established quality gates with Git workflows, CI/CD pipelines, and security-first development practices",
          "Mentored team of 4 developers on SAP UI5 best practices and design patterns",
        ],
        tags: ["SAP UI5", "Fiori", "BTP", "Node.js", "OData V4", "CI/CD"],
      },
      {
        title: "Solutions Architect",
        client: "Enterprise Software Lab · India",
        time: "Sep 2022 — Apr 2024",
        type: "Developer",
        industry: "Hi-Tech",
        points: [
          "Developed Node.js and UI5 prototypes on BTP to showcase cutting-edge product capabilities",
          "Delivered MVP per sprint cycle with multi-environment deployment strategies",
          "Integrated GenAI capabilities for intelligent document processing workflows",
        ],
        tags: ["Node.js", "SAP UI5", "BTP", "OData", "GenAI"],
      },
    ],
  },
  {
    company: "IBM India",
    role: "Application Consultant",
    period: "Jan 2020 — Aug 2022",
    location: "Bengaluru, India",
    description:
      "Delivered enterprise HR and supply chain solutions for global clients across healthcare, aerospace, and HRMS domains.",
    items: [
      {
        title: "Cloud HR Solutions Developer",
        client: "Leading Healthcare Group · Singapore",
        time: "Mar 2022 — Aug 2022",
        type: "Developer",
        industry: "Healthcare",
        points: [
          "Built UI5 modules and BTP integrations for cloud HR benefits and claims workflows",
          "Achieved 40% reduction in processing time through optimized OData services",
        ],
        tags: ["UI5", "BTP", "OData", "Cloud HR"],
      },
      {
        title: "S/4HANA Migration Specialist",
        client: "Leading Aerospace Enterprise · Canada",
        time: "Sep 2021 — Feb 2022",
        type: "Developer",
        industry: "Aerospace",
        points: [
          "Developed custom UI5 returns management process with CDS views and OData services",
          "Led UAT defect resolution achieving 98% first-pass acceptance rate",
        ],
        tags: ["UI5", "WorkZone", "CDS", "S/4HANA"],
      },
      {
        title: "HR Workflow Developer",
        client: "Fortune 100 CIO Organization",
        time: "Sep 2020 — Sep 2021",
        type: "Developer",
        industry: "HRMS",
        points: [
          "Designed end-to-end contractor lifecycle workflows from onboarding to offboarding",
          "Configured SAP Launchpad with role-based access and custom UI extensions",
        ],
        tags: ["UI5", "OData", "Neo", "Launchpad"],
      },
      {
        title: "Security Solutions Developer",
        client: "Internal Initiative",
        time: "Apr 2020 — Aug 2020",
        type: "Solo Developer",
        industry: "Security",
        points: [
          "Built self-service password reset portal from POC to production MVP",
          "Implemented secure authentication flows with audit logging",
        ],
        tags: ["UI5", "OData", "Security"],
      },
    ],
  },
  {
    company: "Cognizant",
    role: "Associate — Projects",
    period: "Mar 2019 — Dec 2019",
    location: "Bengaluru, India",
    description:
      "Contributed to large-scale telecom automation projects with focus on microservices architecture.",
    items: [
      {
        title: "Microservices Developer",
        client: "Major Telecom Operator · Australia",
        time: "Mar 2019 — Dec 2019",
        type: "Developer",
        industry: "Telecom",
        points: [
          "Developed microservices for test data management automation and orchestration",
          "Designed service contracts and database schemas with comprehensive unit test coverage",
        ],
        tags: ["Microservices", "React", "Node.js", "PostgreSQL"],
      },
    ],
  },
  {
    company: "Mindtree",
    role: "Senior Software Engineer",
    period: "Jul 2018 — Mar 2019",
    location: "Bengaluru, India",
    description:
      "Specialized in security hardening and performance optimization for enterprise travel systems.",
    items: [
      {
        title: "Security Engineer",
        client: "Global Travel & Transport Provider",
        time: "Jul 2018 — Mar 2019",
        type: "Developer",
        industry: "Travel",
        points: [
          "Remediated critical security vulnerabilities including XSS, SQLi, and log forging",
          "Refactored core utilities achieving 30% performance improvement",
          "Implemented cache intelligence system reducing database load by 45%",
        ],
        tags: ["Security", "Java", "Caching", "Performance"],
      },
    ],
  },
  {
    company: "Wipro",
    role: "Project Engineer",
    period: "Sep 2015 — Jul 2018",
    location: "Bengaluru, India",
    description:
      "Foundation years building enterprise applications across IoT, infrastructure management, and security domains.",
    items: [
      {
        title: "Full Stack Developer",
        client: "Multiple Enterprise Clients",
        time: "Sep 2015 — Jul 2018",
        type: "Developer",
        industry: "Multiple",
        points: [
          "Developed Haystack API for building management with IoT integration",
          "Built converged infrastructure automation for servers, storage, and networking",
          "Contributed to security management system with SAST integration",
        ],
        tags: ["Spring MVC", "REST", "Automation", "SAST"],
      },
    ],
  },
];

const PROJECTS_DATA = [
  {
    year: 2024,
    name: "MedTech Enterprise Suite",
    badge: "Healthcare",
    client: "Fortune 500 Pharma",
    desc: "Comprehensive Fiori UI5 application suite on SAP BTP powering internal operations, clinical support workflows, and regulatory compliance dashboards.",
    tags: ["UI5", "BTP", "OData V4", "Fiori Elements"],
    icon: <Security />,
  },
  {
    year: 2024,
    name: "GenAI Document Processor",
    badge: "AI/ML",
    client: "Enterprise Lab",
    desc: "Intelligent document processing system integrating multiple LLMs for automated data extraction, classification, and validation.",
    tags: ["GenAI", "Node.js", "SAP AI Core"],
    icon: <IntegrationInstructions />,
  },
  {
    year: 2022,
    name: "Cloud HR Platform",
    badge: "HRMS",
    client: "Healthcare Group",
    desc: "End-to-end benefits and claims management platform with secure OData services and seamless launchpad integration.",
    tags: ["UI5", "BTP", "Launchpad", "Cloud HR"],
    icon: <Cloud />,
  },
  {
    year: 2022,
    name: "Aerospace Returns Portal",
    badge: "Aerospace",
    client: "Leading Enterprise",
    desc: "Custom S/4HANA returns management solution with advanced CDS views and WorkZone integration.",
    tags: ["UI5", "CDS", "WorkZone", "S/4HANA"],
    icon: <RocketLaunch />,
  },
  {
    year: 2021,
    name: "Contractor Lifecycle Manager",
    badge: "HRMS",
    client: "Fortune 100",
    desc: "Comprehensive contractor management from onboarding to offboarding with role-based launchpad configuration.",
    tags: ["UI5", "OData", "Launchpad"],
    icon: <WorkOutline />,
  },
  {
    year: 2019,
    name: "TDM Automation Platform",
    badge: "Telecom",
    client: "Major Telecom",
    desc: "Microservices-driven test data management platform enabling automated data provisioning and orchestration.",
    tags: ["Microservices", "React", "Node.js"],
    icon: <Storage />,
  },
];

const SKILLS_DATA = {
  core: [
    "SAP UI5 / Fiori",
    "CAPM (Node.js)",
    "SAP BTP",
    "OData V4 / REST",
    "JavaScript / TypeScript",
    "MongoDB",
    "Git / GitHub",
    "GenAI Integration",
  ],
  tooling: [
    "SAP Business Application Studio",
    "Postman / Thunder Client",
    "Docker / Kubernetes",
    "Cloud Foundry",
    "Agile / Scrum",
    "JIRA / Confluence",
    "OpenAPI / Swagger",
    "Jenkins / GitHub Actions",
  ],
  soft: [
    "Technical Leadership",
    "Stakeholder Management",
    "Technical Documentation",
    "Code Reviews & Mentoring",
    "Agile Sprint Planning",
    "Cross-functional Collaboration",
  ],
};

/* =============================================================================
   DESIGN SYSTEM
============================================================================= */

const designTokens = {
  colors: {
    bg: {
      primary: "#030303",
      secondary: "#0A0A0B",
      card: "#0F0F10",
      cardHover: "#141415",
      elevated: "#1A1A1B",
    },
    text: {
      primary: "#FFFFFF",
      secondary: "#C4C4C4",
      tertiary: "#8A8A8A",
      muted: "#5A5A5A",
    },
    border: {
      subtle: "#1A1A1B",
      card: "#252528",
      hover: "#3A3A3D",
      accent: "#404045",
    },
    accent: {
      primary: "#00D4AA",
      secondary: "#6366F1",
      tertiary: "#F59E0B",
      whatsapp: "#25D366",
      blue: "#3B82F6",
      purple: "#8B5CF6",
      rose: "#F43F5E",
      cyan: "#06B6D4",
      linkedin: "#0A66C2",
    },
    gradient: {
      primary: "linear-gradient(135deg, #00D4AA 0%, #6366F1 100%)",
      secondary: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
      gold: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
    },
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    xxl: "24px",
    full: "9999px",
  },
  shadow: {
    sm: "0 2px 8px rgba(0,0,0,0.3)",
    md: "0 4px 16px rgba(0,0,0,0.4)",
    lg: "0 8px 32px rgba(0,0,0,0.5)",
    xl: "0 16px 48px rgba(0,0,0,0.6)",
    glow: (color) => `0 0 40px ${alpha(color, 0.3)}`,
  },
};

const muiTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: designTokens.colors.accent.primary },
    background: {
      default: designTokens.colors.bg.primary,
      paper: designTokens.colors.bg.card,
    },
    text: {
      primary: designTokens.colors.text.primary,
      secondary: designTokens.colors.text.secondary,
    },
  },
  typography: {
    fontFamily:
      '"Plus Jakarta Sans", "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    h1: { fontWeight: 800, letterSpacing: "-0.03em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    body1: { lineHeight: 1.7 },
    body2: { lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: "0.7rem",
          borderRadius: designTokens.radius.sm,
          border: `1px solid ${designTokens.colors.border.card}`,
          backgroundColor: designTokens.colors.bg.card,
        },
      },
    },
  },
});

/* =============================================================================
   ANIMATION VARIANTS
============================================================================= */

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

/* =============================================================================
   COMPONENTS
============================================================================= */

const MotionBox = motion(Box);

const Card = ({ children, sx, delay = 0, glowColor }) => (
  <MotionBox
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: "-50px" }}
    variants={fadeInUp}
    transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
    sx={{
      position: "relative",
      bgcolor: designTokens.colors.bg.card,
      border: `1px solid ${designTokens.colors.border.card}`,
      borderRadius: designTokens.radius.xl,
      transition: "all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)",
      height: "100%",
      overflow: "hidden",
      "&:hover": {
        bgcolor: designTokens.colors.bg.cardHover,
        borderColor: designTokens.colors.border.hover,
        transform: "translateY(-4px)",
        boxShadow: glowColor
          ? designTokens.shadow.glow(glowColor)
          : designTokens.shadow.lg,
      },
      ...sx,
    }}
  >
    {children}
  </MotionBox>
);

const SectionHeader = memo(({ badge, title, subtitle, align = "left" }) => (
  <Box sx={{ mb: { xs: 6, md: 8 }, textAlign: align }}>
    {badge && (
      <MotionBox
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          px: 2.5,
          py: 1,
          mb: 2.5,
          borderRadius: designTokens.radius.full,
          background: alpha(designTokens.colors.accent.primary, 0.1),
          border: `1px solid ${alpha(designTokens.colors.accent.primary, 0.2)}`,
          backdropFilter: "blur(8px)",
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: designTokens.colors.gradient.primary,
            boxShadow: `0 0 10px ${designTokens.colors.accent.primary}`,
          }}
        />
        <Typography
          sx={{
            fontSize: "0.7rem",
            fontWeight: 700,
            background: designTokens.colors.gradient.primary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
          }}
        >
          {badge}
        </Typography>
      </MotionBox>
    )}
    <Typography
      variant="h2"
      sx={{
        fontSize: { xs: "2rem", sm: "2.5rem", md: "3rem" },
        lineHeight: 1.15,
        mb: 2,
        color: "#FFF",
      }}
    >
      {title}
    </Typography>
    {subtitle && (
      <Typography
        sx={{
          fontSize: { xs: "1rem", md: "1.1rem" },
          color: designTokens.colors.text.tertiary,
          maxWidth: align === "center" ? 600 : 650,
          mx: align === "center" ? "auto" : 0,
          lineHeight: 1.7,
        }}
      >
        {subtitle}
      </Typography>
    )}
  </Box>
));

const CTAButton = ({
  children,
  variant = "primary",
  href,
  icon,
  onClick,
  sx,
}) => {
  const isPrimary = variant === "primary";
  const Component = href ? "a" : "button";
  return (
    <MotionBox
      component={Component}
      href={href}
      onClick={onClick}
      target={href && !href.startsWith("#") ? "_blank" : "_self"}
      rel="noopener noreferrer"
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        px: { xs: 3, md: 4 },
        py: { xs: 1.25, md: 1.5 },
        fontSize: { xs: "0.85rem", md: "0.9rem" },
        fontWeight: 600,
        color: isPrimary ? "#000" : "#FFF",
        background: isPrimary
          ? designTokens.colors.gradient.primary
          : "transparent",
        border: isPrimary
          ? "none"
          : `1px solid ${designTokens.colors.border.hover}`,
        borderRadius: designTokens.radius.full,
        cursor: "pointer",
        textDecoration: "none",
        transition: "all 0.3s ease",
        boxShadow: isPrimary
          ? `0 4px 20px ${alpha(designTokens.colors.accent.primary, 0.3)}`
          : "none",
        "&:hover": {
          boxShadow: isPrimary
            ? `0 8px 30px ${alpha(designTokens.colors.accent.primary, 0.4)}`
            : `0 4px 20px rgba(255,255,255,0.1)`,
          background: !isPrimary && "rgba(255,255,255,0.05)",
        },
        ...sx,
      }}
    >
      {children}
      {icon && <Box sx={{ fontSize: 18, display: "flex" }}>{icon}</Box>}
    </MotionBox>
  );
};

const StatBadge = ({ value, label }) => (
  <Box sx={{ textAlign: "center" }}>
    <Typography
      sx={{
        fontSize: "1.75rem",
        fontWeight: 800,
        background: designTokens.colors.gradient.primary,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: 1,
      }}
    >
      {value}
    </Typography>
    <Typography
      sx={{
        fontSize: "0.75rem",
        color: designTokens.colors.text.muted,
        mt: 0.5,
      }}
    >
      {label}
    </Typography>
  </Box>
);

/* =============================================================================
   RESUME VIEWER MODAL
============================================================================= */

const ResumeModal = ({ open, onClose }) => (
  <Modal
    open={open}
    onClose={onClose}
    closeAfterTransition
    BackdropComponent={Backdrop}
    BackdropProps={{ timeout: 500, sx: { bgcolor: "rgba(0,0,0,0.9)" } }}
  >
    <Fade in={open}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: { xs: "95%", md: "80%" },
          height: { xs: "90%", md: "90%" },
          bgcolor: designTokens.colors.bg.card,
          borderRadius: designTokens.radius.xl,
          border: `1px solid ${designTokens.colors.border.card}`,
          boxShadow: designTokens.shadow.xl,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            p: 2,
            borderBottom: `1px solid ${designTokens.colors.border.card}`,
          }}
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <PictureAsPdf sx={{ color: designTokens.colors.accent.rose }} />
            <Typography sx={{ fontWeight: 600, color: "#FFF" }}>
              Resume - Vinay Kumar Tiwari
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <CTAButton
              href={resumePDF}
              icon={<Download />}
              sx={{
                py: 1,
                px: 2.5,
                fontSize: "0.8rem",
              }}
            >
              Download
            </CTAButton>
            <IconButton
              onClick={onClose}
              sx={{ color: designTokens.colors.text.tertiary }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>
        {/* PDF Viewer */}
        <Box sx={{ flex: 1, overflow: "hidden" }}>
          <iframe
            src={`${resumePDF}#toolbar=0&navpanes=0`}
            title="Resume"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
          />
        </Box>
      </Box>
    </Fade>
  </Modal>
);

/* =============================================================================
   SECTIONS
============================================================================= */

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const navLinks = ["About", "Skills", "Experience", "Projects", "Contact"];

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const scrollToTop = (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <Box
        component="nav"
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          display: "flex",
          justifyContent: "center",
          px: 2,
          py: 1.5,
          bgcolor: scrolled ? "rgba(3, 3, 3, 0.9)" : "transparent",
          backdropFilter: scrolled ? "blur(20px) saturate(180%)" : "none",
          borderBottom: scrolled
            ? `1px solid ${designTokens.colors.border.subtle}`
            : "none",
          transition: "all 0.4s ease",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            maxWidth: 1200,
          }}
        >
          {/* Logo & Name - Clickable */}
          <Box
            component="a"
            href="#"
            onClick={scrollToTop}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              textDecoration: "none",
              cursor: "pointer",
              transition: "opacity 0.2s ease",
              "&:hover": { opacity: 0.8 },
            }}
          >
            <Avatar
              src={logo}
              sx={{
                width: 40,
                height: 40,
                border: `2px solid ${designTokens.colors.border.card}`,
                transition: "all 0.3s ease",
                "&:hover": {
                  borderColor: designTokens.colors.accent.primary,
                  boxShadow: `0 0 20px ${alpha(designTokens.colors.accent.primary, 0.3)}`,
                },
              }}
            />
            <Typography
              sx={{
                fontSize: "1.05rem",
                fontWeight: 700,
                color: "#FFF",
                letterSpacing: "-0.01em",
              }}
            >
              Vinay Tiwari
            </Typography>
          </Box>

          {!isMobile && (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
              }}
            >
              {navLinks.map((item) => (
                <Box
                  key={item}
                  component="a"
                  href={`#${item.toLowerCase()}`}
                  sx={{
                    px: 2,
                    py: 1,
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    color: designTokens.colors.text.tertiary,
                    textDecoration: "none",
                    borderRadius: designTokens.radius.full,
                    transition: "all 0.25s ease",
                    "&:hover": {
                      color: "#FFF",
                      bgcolor: "rgba(255,255,255,0.05)",
                    },
                  }}
                >
                  {item}
                </Box>
              ))}
            </Stack>
          )}

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {!isMobile && (
              <>
                <IconButton
                  size="small"
                  href={PROFILE_DATA.linkedin}
                  target="_blank"
                  sx={{
                    color: designTokens.colors.accent.linkedin,
                    transition: "all 0.25s ease",
                    "&:hover": { transform: "scale(1.1)" },
                  }}
                >
                  <LinkedIn sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  href={PROFILE_DATA.github}
                  target="_blank"
                  sx={{
                    color: designTokens.colors.text.tertiary,
                    transition: "all 0.25s ease",
                    "&:hover": { color: "#FFF", transform: "scale(1.1)" },
                  }}
                >
                  <GitHub sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  href={PROFILE_DATA.whatsapp}
                  target="_blank"
                  sx={{
                    color: designTokens.colors.accent.whatsapp,
                    transition: "all 0.25s ease",
                    "&:hover": { transform: "scale(1.1)" },
                  }}
                >
                  <WhatsApp sx={{ fontSize: 20 }} />
                </IconButton>
              </>
            )}
            {isMobile && (
              <IconButton
                onClick={() => setMenuOpen(true)}
                sx={{ color: "#FFF" }}
              >
                <MenuIcon />
              </IconButton>
            )}
          </Box>
        </Box>
      </Box>

      {/* Mobile Menu */}
      <AnimatePresence>
        {menuOpen && (
          <Box
            component={motion.div}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            sx={{
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              bgcolor: designTokens.colors.bg.primary,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              p: 4,
            }}
          >
            <IconButton
              onClick={() => setMenuOpen(false)}
              sx={{ position: "absolute", top: 16, right: 16, color: "#FFF" }}
            >
              <CloseIcon />
            </IconButton>
            <Stack spacing={3} alignItems="center">
              {navLinks.map((item, i) => (
                <MotionBox
                  key={item}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Typography
                    component="a"
                    href={`#${item.toLowerCase()}`}
                    onClick={() => setMenuOpen(false)}
                    sx={{
                      fontSize: "1.5rem",
                      fontWeight: 600,
                      color: "#FFF",
                      textDecoration: "none",
                    }}
                  >
                    {item}
                  </Typography>
                </MotionBox>
              ))}
            </Stack>
          </Box>
        )}
      </AnimatePresence>
    </>
  );
};

const Hero = () => {
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const [isHovered, setIsHovered] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);

  return (
    <Box
      id="about"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        pt: { xs: 12, md: 10 },
        pb: { xs: 6, md: 0 },
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background Elements */}
      <Box
        sx={{
          position: "absolute",
          top: "10%",
          right: "-5%",
          width: 600,
          height: 600,
          background: `radial-gradient(circle, ${alpha(designTokens.colors.accent.secondary, 0.08)} 0%, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          bottom: "10%",
          left: "-10%",
          width: 500,
          height: 500,
          background: `radial-gradient(circle, ${alpha(designTokens.colors.accent.primary, 0.06)} 0%, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        {!isMobile ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            {/* Left: Text Content */}
            <Box sx={{ flex: 1, maxWidth: 650 }}>
              <MotionBox
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <Chip
                  icon={
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: designTokens.colors.accent.whatsapp,
                        boxShadow: `0 0 10px ${designTokens.colors.accent.whatsapp}`,
                        ml: 0.5,
                      }}
                    />
                  }
                  label={PROFILE_DATA.currentRole}
                  sx={{
                    mb: 3,
                    bgcolor: alpha(designTokens.colors.accent.whatsapp, 0.1),
                    borderColor: alpha(
                      designTokens.colors.accent.whatsapp,
                      0.2,
                    ),
                  }}
                />
              </MotionBox>

              <MotionBox
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.1 }}
              >
                <Typography
                  variant="h1"
                  sx={{
                    fontSize: { md: "3.25rem", lg: "4rem", xl: "4.5rem" },
                    lineHeight: 1.05,
                    mb: 3,
                    color: "#FFF",
                  }}
                >
                  Building the{" "}
                  <Box
                    component="span"
                    sx={{
                      background: designTokens.colors.gradient.primary,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    Digital Future
                  </Box>
                </Typography>
              </MotionBox>

              <MotionBox
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
              >
                <Typography
                  sx={{
                    fontSize: "1.05rem",
                    color: designTokens.colors.text.secondary,
                    mb: 4,
                    lineHeight: 1.8,
                    textAlign: "justify",
                    "& strong": {
                      color: "#FFF",
                      fontWeight: 600,
                    },
                  }}
                >
                  Pragmatic engineer with{" "}
                  <strong>10+ years of IT experience</strong>, including{" "}
                  <strong>
                    6+ years of deep specialization in SAP UI5 and Fiori
                    development on SAP BTP
                  </strong>
                  , delivering scalable, secure{" "}
                  <strong>SAP CAP services using Node.js</strong>, with{" "}
                  <strong>
                    GenAI integration (ChatGPT, Grok, Gemini, Claude.ai)
                  </strong>{" "}
                  applied where it delivers measurable business value.
                </Typography>
              </MotionBox>

              <MotionBox
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.3 }}
              >
                <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
                  <CTAButton href="#skills" icon={<ArrowForward />}>
                    View Portfolio
                  </CTAButton>
                  <CTAButton
                    variant="secondary"
                    href="#contact"
                    icon={<MailOutline />}
                  >
                    Contact Me
                  </CTAButton>
                </Stack>
                {/* Resume Buttons */}
                <Stack direction="row" spacing={2}>
                  <CTAButton
                    variant="secondary"
                    onClick={() => setResumeOpen(true)}
                    icon={<Visibility />}
                    sx={{
                      borderColor: alpha(designTokens.colors.accent.rose, 0.4),
                      color: designTokens.colors.accent.rose,
                      "&:hover": {
                        borderColor: designTokens.colors.accent.rose,
                        bgcolor: alpha(designTokens.colors.accent.rose, 0.1),
                      },
                    }}
                  >
                    View Resume
                  </CTAButton>
                  <CTAButton
                    variant="secondary"
                    href={resumePDF}
                    icon={<Download />}
                    sx={{
                      borderColor: alpha(
                        designTokens.colors.accent.secondary,
                        0.4,
                      ),
                      color: designTokens.colors.accent.secondary,
                      "&:hover": {
                        borderColor: designTokens.colors.accent.secondary,
                        bgcolor: alpha(
                          designTokens.colors.accent.secondary,
                          0.1,
                        ),
                      },
                    }}
                  >
                    Download CV
                  </CTAButton>
                </Stack>
              </MotionBox>

              <MotionBox
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.4 }}
              >
                <Stack
                  direction="row"
                  spacing={5}
                  sx={{
                    pt: 4,
                    mt: 4,
                    borderTop: `1px solid ${designTokens.colors.border.card}`,
                  }}
                >
                  <StatBadge value="10+" label="Years Experience" />
                  <StatBadge value="11+" label="Projects Delivered" />
                  <StatBadge value="6+" label="SAP Specialization" />
                </Stack>
              </MotionBox>
            </Box>

            {/* Right: Photo */}
            <MotionBox
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              onHoverStart={() => setIsHovered(true)}
              onHoverEnd={() => setIsHovered(false)}
              sx={{
                flexShrink: 0,
                position: "relative",
              }}
            >
              {/* Glow effect */}
              <Box
                sx={{
                  position: "absolute",
                  inset: -20,
                  background: `radial-gradient(circle, ${alpha(designTokens.colors.accent.primary, isHovered ? 0.3 : 0.15)} 0%, transparent 70%)`,
                  transition: "all 0.5s ease",
                  filter: "blur(30px)",
                }}
              />
              <Box
                sx={{
                  position: "relative",
                  width: { md: 300, lg: 340, xl: 380 },
                  height: { md: 380, lg: 430, xl: 480 },
                  borderRadius: designTokens.radius.xxl,
                  overflow: "hidden",
                  border: `2px solid ${isHovered ? designTokens.colors.accent.primary : designTokens.colors.border.card}`,
                  boxShadow: isHovered
                    ? `0 25px 60px ${alpha(designTokens.colors.accent.primary, 0.3)}`
                    : designTokens.shadow.xl,
                  transition: "all 0.5s cubic-bezier(0.25, 0.1, 0.25, 1)",
                  transform: isHovered
                    ? "scale(1.02) rotate(1deg)"
                    : "scale(1)",
                }}
              >
                <Box
                  component="img"
                  src={photo}
                  alt={PROFILE_DATA.name}
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "center top",
                    transition: "all 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)",
                    filter: isHovered
                      ? "brightness(1.1) contrast(1.05)"
                      : "none",
                    transform: isHovered ? "scale(1.05)" : "scale(1)",
                  }}
                />
                {/* Shine overlay */}
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    background: isHovered
                      ? "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,212,170,0.1) 100%)"
                      : "transparent",
                    transition: "all 0.5s ease",
                  }}
                />
              </Box>
            </MotionBox>
          </Box>
        ) : (
          /* Mobile Layout */
          <Box sx={{ textAlign: "center" }}>
            <MotionBox
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6 }}
              sx={{ display: "flex", justifyContent: "center", mb: 4 }}
            >
              <Box
                sx={{
                  position: "relative",
                  width: 200,
                  height: 260,
                  borderRadius: designTokens.radius.xl,
                  overflow: "hidden",
                  border: `2px solid ${designTokens.colors.border.card}`,
                  boxShadow: designTokens.shadow.lg,
                }}
              >
                <Box
                  component="img"
                  src={photo}
                  alt={PROFILE_DATA.name}
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "center top",
                  }}
                />
              </Box>
            </MotionBox>

            <Chip
              icon={
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: designTokens.colors.accent.whatsapp,
                    ml: 0.5,
                  }}
                />
              }
              label={PROFILE_DATA.currentRole}
              sx={{ mb: 3, fontSize: "0.65rem" }}
            />

            <Typography
              variant="h1"
              sx={{
                fontSize: "2.25rem",
                lineHeight: 1.1,
                mb: 2,
                color: "#FFF",
              }}
            >
              Building the{" "}
              <Box
                component="span"
                sx={{
                  background: designTokens.colors.gradient.primary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Digital Future
              </Box>
            </Typography>

            <Typography
              sx={{
                fontSize: "0.9rem",
                color: designTokens.colors.text.secondary,
                mb: 4,
                lineHeight: 1.7,
                textAlign: "justify",
                px: 1,
                "& strong": { color: "#FFF", fontWeight: 600 },
              }}
            >
              Pragmatic engineer with{" "}
              <strong>10+ years of IT experience</strong>, including{" "}
              <strong>
                6+ years of deep specialization in SAP UI5 and Fiori development
                on SAP BTP
              </strong>
              , delivering scalable, secure{" "}
              <strong>SAP CAP services using Node.js</strong>, with{" "}
              <strong>GenAI integration</strong> applied where it delivers
              measurable business value.
            </Typography>

            <Stack
              direction="column"
              spacing={2}
              alignItems="center"
              sx={{ mb: 3 }}
            >
              <CTAButton
                href="#skills"
                icon={<ArrowForward />}
                sx={{ width: "100%", maxWidth: 280 }}
              >
                View Portfolio
              </CTAButton>
              <CTAButton
                variant="secondary"
                href="#contact"
                icon={<MailOutline />}
                sx={{ width: "100%", maxWidth: 280 }}
              >
                Contact Me
              </CTAButton>
            </Stack>

            <Stack
              direction="row"
              spacing={2}
              justifyContent="center"
              sx={{ mb: 4 }}
            >
              <CTAButton
                variant="secondary"
                onClick={() => setResumeOpen(true)}
                icon={<Visibility />}
                sx={{
                  py: 1,
                  px: 2,
                  fontSize: "0.8rem",
                  borderColor: alpha(designTokens.colors.accent.rose, 0.4),
                  color: designTokens.colors.accent.rose,
                }}
              >
                View CV
              </CTAButton>
              <CTAButton
                variant="secondary"
                href={resumePDF}
                icon={<Download />}
                sx={{
                  py: 1,
                  px: 2,
                  fontSize: "0.8rem",
                  borderColor: alpha(designTokens.colors.accent.secondary, 0.4),
                  color: designTokens.colors.accent.secondary,
                }}
              >
                Download
              </CTAButton>
            </Stack>

            <Stack direction="row" spacing={4} justifyContent="center">
              <StatBadge value="10+" label="Years" />
              <StatBadge value="11+" label="Projects" />
              <StatBadge value="6+" label="SAP" />
            </Stack>
          </Box>
        )}
      </Container>

      {/* Resume Modal */}
      <ResumeModal open={resumeOpen} onClose={() => setResumeOpen(false)} />
    </Box>
  );
};

const Certifications = () => (
  <Box
    sx={{ py: { xs: 8, md: 10 }, bgcolor: designTokens.colors.bg.secondary }}
  >
    <Container maxWidth="lg">
      <SectionHeader
        badge="Credentials"
        title="Certifications & Training"
        subtitle="Industry-recognized certifications validating expertise in SAP technologies, agile methodologies, and cloud architecture."
      />
      <Grid container spacing={2.5}>
        {CERTIFICATIONS_DATA.map((cert, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Card delay={i * 0.08} glowColor={cert.color}>
              <Box sx={{ p: 3, height: "100%" }}>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: designTokens.radius.md,
                      bgcolor: alpha(cert.color, 0.1),
                      border: `1px solid ${alpha(cert.color, 0.2)}`,
                      color: cert.color,
                      flexShrink: 0,
                    }}
                  >
                    {cert.issuer === "SAP" ? <VerifiedUser /> : <School />}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      sx={{
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        color: "#FFF",
                        mb: 0.5,
                        lineHeight: 1.3,
                      }}
                    >
                      {cert.title}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: "0.8rem",
                        color: designTokens.colors.text.secondary,
                        mb: 1,
                      }}
                    >
                      {cert.subtitle}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Chip
                        label={cert.issuer}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: "0.6rem",
                          bgcolor: alpha(cert.color, 0.15),
                          borderColor: alpha(cert.color, 0.25),
                          color: cert.color,
                        }}
                      />
                      {cert.code && (
                        <Typography
                          sx={{
                            fontSize: "0.65rem",
                            color: designTokens.colors.text.muted,
                            fontFamily: "monospace",
                          }}
                        >
                          {cert.code}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  </Box>
);

const Skills = () => {
  const categories = [
    {
      title: "Core Technologies",
      icon: <Code />,
      color: designTokens.colors.accent.blue,
      skills: SKILLS_DATA.core,
    },
    {
      title: "Tools & Platforms",
      icon: <RocketLaunch />,
      color: designTokens.colors.accent.primary,
      skills: SKILLS_DATA.tooling,
    },
    {
      title: "Leadership & Soft Skills",
      icon: <EmojiObjectsOutlined />,
      color: designTokens.colors.accent.tertiary,
      skills: SKILLS_DATA.soft,
    },
  ];

  return (
    <Box id="skills" sx={{ py: { xs: 10, md: 14 } }}>
      <Container maxWidth="lg">
        <SectionHeader
          badge="Expertise"
          title="Technical Arsenal"
          subtitle="A comprehensive toolkit honed through a decade of enterprise software development across diverse domains."
        />
        <Grid container spacing={3}>
          {categories.map((cat, i) => (
            <Grid item xs={12} md={4} key={cat.title}>
              <Card delay={i * 0.1} glowColor={cat.color}>
                <Box sx={{ p: { xs: 3, md: 4 } }}>
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: designTokens.radius.lg,
                      background: alpha(cat.color, 0.1),
                      border: `1px solid ${alpha(cat.color, 0.2)}`,
                      color: cat.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      mb: 3,
                    }}
                  >
                    {cat.icon}
                  </Box>
                  <Typography
                    sx={{
                      mb: 3,
                      fontSize: "1.2rem",
                      fontWeight: 600,
                      color: "#FFF",
                    }}
                  >
                    {cat.title}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {cat.skills.map((s) => (
                      <Chip
                        key={s}
                        label={s}
                        size="small"
                        sx={{
                          bgcolor: designTokens.colors.bg.elevated,
                          color: designTokens.colors.text.secondary,
                          borderColor: designTokens.colors.border.card,
                          fontSize: "0.7rem",
                          height: 28,
                          transition: "all 0.25s ease",
                          "&:hover": {
                            bgcolor: alpha(cat.color, 0.15),
                            borderColor: alpha(cat.color, 0.3),
                            color: "#FFF",
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};

const Experience = () => (
  <Box
    id="experience"
    sx={{ py: { xs: 10, md: 14 }, bgcolor: designTokens.colors.bg.secondary }}
  >
    <Container maxWidth="lg">
      <SectionHeader
        badge="Career Journey"
        title="Professional Experience"
        subtitle="A decade of building enterprise solutions across Fortune 500 companies, delivering impactful digital transformations globally."
      />

      <Stack spacing={8}>
        {EXPERIENCE_DATA.map((job, jobIndex) => (
          <MotionBox
            key={jobIndex}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={fadeInUp}
            transition={{ duration: 0.6, delay: jobIndex * 0.1 }}
          >
            {/* Company Header Card */}
            <Card
              sx={{ mb: 3, p: { xs: 3, md: 4 } }}
              glowColor={designTokens.colors.accent.secondary}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={2}
              >
                <Box>
                  <Typography
                    sx={{
                      fontSize: { xs: "1.4rem", md: "1.6rem" },
                      fontWeight: 700,
                      color: "#FFF",
                      mb: 0.5,
                    }}
                  >
                    {job.role}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      background: designTokens.colors.gradient.primary,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      mb: 1,
                    }}
                  >
                    {job.company}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "0.9rem",
                      color: designTokens.colors.text.tertiary,
                      lineHeight: 1.6,
                    }}
                  >
                    {job.description}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={2}
                  alignItems="center"
                  flexShrink={0}
                >
                  <Chip
                    icon={
                      <CalendarToday sx={{ fontSize: "14px !important" }} />
                    }
                    label={job.period}
                    size="small"
                    sx={{
                      bgcolor: alpha(designTokens.colors.accent.secondary, 0.1),
                      borderColor: alpha(
                        designTokens.colors.accent.secondary,
                        0.2,
                      ),
                      color: designTokens.colors.accent.secondary,
                      "& .MuiChip-icon": { color: "inherit" },
                    }}
                  />
                  <Chip
                    icon={<LocationOn sx={{ fontSize: "14px !important" }} />}
                    label={job.location}
                    size="small"
                    sx={{
                      bgcolor: alpha(designTokens.colors.text.muted, 0.1),
                      borderColor: designTokens.colors.border.card,
                      "& .MuiChip-icon": { color: "inherit" },
                    }}
                  />
                </Stack>
              </Stack>
            </Card>

            {/* Job Items Grid */}
            <Grid container spacing={2.5}>
              {job.items.map((item, i) => (
                <Grid item xs={12} md={6} key={i}>
                  <Card
                    delay={i * 0.05}
                    glowColor={designTokens.colors.accent.primary}
                    sx={{ height: "100%" }}
                  >
                    <Box
                      sx={{
                        p: 3,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="flex-start"
                        sx={{ mb: 2 }}
                      >
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            sx={{
                              fontSize: "1rem",
                              fontWeight: 600,
                              color: "#FFF",
                              mb: 0.5,
                            }}
                          >
                            {item.title}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                          >
                            <Typography
                              sx={{
                                fontSize: "0.75rem",
                                color: designTokens.colors.text.muted,
                              }}
                            >
                              {item.time}
                            </Typography>
                            <Chip
                              label={item.industry}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: "0.6rem",
                                bgcolor: alpha(
                                  designTokens.colors.accent.cyan,
                                  0.1,
                                ),
                                borderColor: alpha(
                                  designTokens.colors.accent.cyan,
                                  0.2,
                                ),
                                color: designTokens.colors.accent.cyan,
                              }}
                            />
                          </Stack>
                        </Box>
                        {item.client && (
                          <Chip
                            label={item.client}
                            size="small"
                            icon={
                              <StarRounded
                                sx={{
                                  fontSize: "12px !important",
                                  color: `${designTokens.colors.accent.tertiary} !important`,
                                }}
                              />
                            }
                            sx={{
                              flexShrink: 0,
                              ml: 1,
                              maxWidth: 160,
                              bgcolor: alpha(
                                designTokens.colors.accent.tertiary,
                                0.1,
                              ),
                              borderColor: alpha(
                                designTokens.colors.accent.tertiary,
                                0.2,
                              ),
                              color: designTokens.colors.accent.tertiary,
                              fontSize: "0.6rem",
                              height: 24,
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                        )}
                      </Stack>

                      <Box
                        component="ul"
                        sx={{
                          m: 0,
                          pl: 2,
                          flex: 1,
                          "& li": {
                            color: designTokens.colors.text.secondary,
                            fontSize: "0.85rem",
                            mb: 1,
                            lineHeight: 1.6,
                            "&::marker": {
                              color: designTokens.colors.accent.primary,
                            },
                          },
                        }}
                      >
                        {item.points.map((pt, idx) => (
                          <li key={idx}>{pt}</li>
                        ))}
                      </Box>

                      <Stack
                        direction="row"
                        spacing={0.75}
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ mt: 2 }}
                      >
                        {item.tags.map((t) => (
                          <Chip
                            key={t}
                            label={t}
                            size="small"
                            sx={{
                              height: 22,
                              fontSize: "0.6rem",
                              bgcolor: designTokens.colors.bg.elevated,
                              borderColor: designTokens.colors.border.subtle,
                            }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </MotionBox>
        ))}
      </Stack>
    </Container>
  </Box>
);

const Projects = () => (
  <Box id="projects" sx={{ py: { xs: 10, md: 14 } }}>
    <Container maxWidth="lg">
      <SectionHeader
        badge="Portfolio"
        title="Featured Work"
        subtitle="Showcasing impactful projects that delivered measurable business value across healthcare, aerospace, telecom, and enterprise domains."
      />

      <Grid container spacing={3}>
        {PROJECTS_DATA.map((p, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Card
              delay={i * 0.08}
              glowColor={designTokens.colors.accent.secondary}
              sx={{ height: "100%" }}
            >
              <Box
                sx={{
                  p: 3,
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: 280,
                }}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                  sx={{ mb: 3 }}
                >
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: designTokens.radius.md,
                      background: alpha(
                        designTokens.colors.accent.secondary,
                        0.1,
                      ),
                      border: `1px solid ${alpha(designTokens.colors.accent.secondary, 0.2)}`,
                      color: designTokens.colors.accent.secondary,
                    }}
                  >
                    {p.icon}
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      label={p.badge}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: "0.6rem",
                        fontWeight: 600,
                        background: alpha(
                          designTokens.colors.accent.primary,
                          0.1,
                        ),
                        borderColor: alpha(
                          designTokens.colors.accent.primary,
                          0.2,
                        ),
                        color: designTokens.colors.accent.primary,
                      }}
                    />
                    <Typography
                      sx={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: designTokens.colors.text.muted,
                      }}
                    >
                      {p.year}
                    </Typography>
                  </Stack>
                </Stack>

                <Typography
                  sx={{
                    fontSize: "1.15rem",
                    fontWeight: 600,
                    color: "#FFF",
                    mb: 1,
                    lineHeight: 1.3,
                  }}
                >
                  {p.name}
                </Typography>

                <Typography
                  sx={{
                    fontSize: "0.8rem",
                    color: designTokens.colors.accent.secondary,
                    mb: 2,
                    fontWeight: 500,
                  }}
                >
                  {p.client}
                </Typography>

                <Typography
                  sx={{
                    fontSize: "0.85rem",
                    color: designTokens.colors.text.tertiary,
                    lineHeight: 1.6,
                    flex: 1,
                    mb: 3,
                  }}
                >
                  {p.desc}
                </Typography>

                <Stack
                  direction="row"
                  spacing={0.75}
                  flexWrap="wrap"
                  useFlexGap
                >
                  {p.tags.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: "0.6rem",
                        bgcolor: designTokens.colors.bg.elevated,
                        borderColor: designTokens.colors.border.subtle,
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  </Box>
);

const Contact = () => (
  <Box
    id="contact"
    sx={{ py: { xs: 10, md: 14 }, bgcolor: designTokens.colors.bg.secondary }}
  >
    <Container maxWidth="md" sx={{ textAlign: "center" }}>
      <SectionHeader
        badge="Get In Touch"
        title={
          <>
            Let's Build{" "}
            <Box
              component="span"
              sx={{
                background: designTokens.colors.gradient.primary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Something Amazing
            </Box>
          </>
        }
        subtitle="Currently available for new opportunities. Whether you have a project in mind or just want to connect, I'd love to hear from you."
        align="center"
      />

      <MotionBox
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={staggerContainer}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="center"
          alignItems="center"
          spacing={{ xs: 2, sm: 4 }}
          sx={{ mb: 6 }}
        >
          {[
            {
              icon: <MailOutline sx={{ fontSize: 20 }} />,
              text: PROFILE_DATA.email,
              href: `mailto:${PROFILE_DATA.email}`,
            },
            {
              icon: <Phone sx={{ fontSize: 20 }} />,
              text: PROFILE_DATA.whatsappNumber,
            },
            {
              icon: <LocationOn sx={{ fontSize: 20 }} />,
              text: PROFILE_DATA.location,
            },
          ].map((item, i) => (
            <MotionBox
              key={i}
              variants={fadeInUp}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                color: designTokens.colors.text.secondary,
                transition: "color 0.25s ease",
                "&:hover": { color: "#FFF" },
              }}
            >
              <Box sx={{ color: designTokens.colors.text.muted }}>
                {item.icon}
              </Box>
              {item.href ? (
                <Link
                  href={item.href}
                  underline="hover"
                  sx={{ color: "inherit", fontSize: "0.9rem", fontWeight: 500 }}
                >
                  {item.text}
                </Link>
              ) : (
                <Typography sx={{ fontSize: "0.9rem", fontWeight: 500 }}>
                  {item.text}
                </Typography>
              )}
            </MotionBox>
          ))}
        </Stack>

        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            gap: 2,
            flexWrap: "wrap",
            mb: 10,
          }}
        >
          <CTAButton
            href={`mailto:${PROFILE_DATA.email}`}
            icon={<MailOutline />}
          >
            Say Hello
          </CTAButton>
          <CTAButton
            variant="secondary"
            href={PROFILE_DATA.linkedin}
            icon={<LinkedIn />}
          >
            LinkedIn
          </CTAButton>
          <CTAButton
            variant="secondary"
            href={PROFILE_DATA.github}
            icon={<GitHub />}
          >
            GitHub
          </CTAButton>
          <CTAButton
            variant="secondary"
            href={PROFILE_DATA.whatsapp}
            icon={<WhatsApp />}
            sx={{
              borderColor: alpha(designTokens.colors.accent.whatsapp, 0.4),
              color: designTokens.colors.accent.whatsapp,
              "&:hover": {
                borderColor: designTokens.colors.accent.whatsapp,
                bgcolor: alpha(designTokens.colors.accent.whatsapp, 0.1),
                boxShadow: `0 4px 20px ${alpha(designTokens.colors.accent.whatsapp, 0.2)}`,
              },
            }}
          >
            WhatsApp
          </CTAButton>
        </Box>
      </MotionBox>

      <Box
        sx={{
          pt: 5,
          borderTop: `1px solid ${designTokens.colors.border.card}`,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Typography
          sx={{ color: designTokens.colors.text.muted, fontSize: "0.85rem" }}
        >
          © {new Date().getFullYear()} {PROFILE_DATA.name}. Crafted with
          passion.
        </Typography>
        <Box
          component="a"
          href="#about"
          sx={{
            color: designTokens.colors.text.muted,
            textDecoration: "none",
            fontSize: "0.85rem",
            transition: "color 0.25s ease",
            "&:hover": { color: designTokens.colors.accent.primary },
          }}
        >
          Back to Top ↑
        </Box>
      </Box>
    </Container>
  </Box>
);

/* =============================================================================
   MAIN EXPORT
============================================================================= */

export default function TCSinterviewAssistantAI() {
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={`
          @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
          
          * { box-sizing: border-box; }
          
          html { 
            scroll-behavior: smooth; 
            scroll-padding-top: 80px;
          }
          
          body { 
            background-color: #030303;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          ::selection { 
            background: rgba(0, 212, 170, 0.3); 
            color: #FFF; 
          }
          
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: #030303; }
          ::-webkit-scrollbar-thumb { 
            background: linear-gradient(180deg, #00D4AA 0%, #6366F1 100%); 
            border-radius: 4px; 
          }
          ::-webkit-scrollbar-thumb:hover { opacity: 0.8; }
        `}
      />
      <Navbar />
      <main>
        <Hero />
        <Certifications />
        <Skills />
        <Experience />
        <Projects />
        <Contact />
      </main>
    </ThemeProvider>
  );
}
