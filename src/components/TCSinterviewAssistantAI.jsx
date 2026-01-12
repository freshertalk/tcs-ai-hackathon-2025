// src/TCSinterviewAssistantAI.jsx
// Status: NAVIGATION FIXED
// Updates: "View Portfolio" -> #skills, "Contact Me" -> #contact
// Features: Equal Grid Cards, Visible Contact Info, Full History

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
} from "@mui/icons-material";
import { createTheme, ThemeProvider, alpha } from "@mui/material/styles";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  AnimatePresence,
} from "framer-motion";

// --- ASSETS ---
import logo from "../assets/logo.avif";
import photo from "../assets/v.avif";

/* =============================================================================
   DATA
============================================================================= */

const PROFILE_DATA = {
  name: "Vinay Tiwari",
  title:
    "Senior Software Developer (10+ yrs) — SAP UI5 / FIORI / CAPM / BTP / GenAI Engineer",
  currentRole: "SAP Cloud Security Consultant",
  email: "vinay.tiwari.sap@gmail.com",
  linkedin: "https://www.linkedin.com/in/vinay-tiwari-sap/",
  whatsapp: "https://wa.me/917392062233",
  whatsappNumber: "+91 73920 62233",
  github: "https://github.com/",
  location: "Noida, India",
  summary:
    "Pragmatic engineer building scalable SAP BTP apps with SAP UI/UX excellence and secure CAPM (Node.js) services, integrating GenAI where it measurably improves outcomes.",
};

const EXPERIENCE_DATA = [
  {
    company: "Tata Consultancy Services",
    role: "Assistant Consultant",
    period: "Aug 2022 — Jan 2026 · Varanasi",
    items: [
      {
        title: "Digital transformation",
        client: "Major Pharma Industry · USA",
        time: "May 2024 — Present · Team lead · Healthcare",
        points: [
          "Fiori-compliant UI5 apps on BTP with real-time OData flows",
          "Rapid prototyping with sprint demos to stakeholders",
          "Quality with Git and CI and secure defaults",
        ],
        tags: ["SAP UI5", "Fiori", "BTP", "Node.js", "OData"],
      },
      {
        title: "Solutions and innovation",
        client: "Enterprise software lab · India",
        time: "Sep 2022 — Apr 2024 · Developer · Hi-tech",
        points: [
          "Node.js and UI5 prototypes on BTP to showcase product capabilities",
          "MVP per sprint and multi-environment maintenance",
        ],
        tags: ["Node.js", "SAP UI5", "BTP", "OData"],
      },
    ],
  },
  {
    company: "IBM India",
    role: "Application Consultant",
    period: "Jan 2020 — Aug 2022",
    items: [
      {
        title: "Cloud HR benefits and claims",
        client: "Leading healthcare group · Singapore",
        time: "Mar 2022 — Aug 2022 · Developer · Healthcare",
        points: [
          "UI5 modules and BTP integrations for cloud HR workflows",
          "Sprint MVP delivery",
        ],
        tags: ["UI5", "BTP", "OData"],
      },
      {
        title: "S/4HANA returns transition",
        client: "Leading aerospace enterprise · Canada",
        time: "Sep 2021 — Feb 2022 · Developer · Aerospace",
        points: [
          "Custom UI5 return process with CDS and OData",
          "UAT defect closure and UTD artifacts",
        ],
        tags: ["UI5", "WorkZone", "CDS"],
      },
      {
        title: "Contractor resource management",
        client: "Fortune 100 CIO organization",
        time: "Sep 2020 — Sep 2021 · Developer · HRMS",
        points: [
          "Lifecycle workflows from onboarding to offboarding",
          "Launchpad configuration and UI customization",
        ],
        tags: ["UI5", "OData", "Neo"],
      },
      {
        title: "Self-service password reset",
        client: "Internal initiative",
        time: "Apr 2020 — Aug 2020 · Solo",
        points: ["UI5 plus OData proof of concept to MVP"],
        tags: ["UI5", "OData"],
      },
    ],
  },
  {
    company: "Cognizant",
    role: "Associate — Projects",
    period: "Mar 2019 — Dec 2019 · Bengaluru",
    items: [
      {
        title: "TDM portal for B2C and B2B",
        client: "Major telecom operator · Australia",
        points: [
          "Microservices for data automation and test orchestration",
          "Service and database design with unit tests",
        ],
        tags: ["Microservices", "React"],
      },
    ],
  },
  {
    company: "Mindtree",
    role: "Senior Software Engineer",
    period: "Jul 2018 — Mar 2019 · Bengaluru",
    items: [
      {
        title: "Revenue management program",
        client: "Global travel and transport provider",
        points: [
          "Security fixes for XSS and SQLi and log forging",
          "Refactored core utilities",
        ],
        tags: ["Security", "Refactoring"],
      },
      {
        title: "DC index cache performance",
        client: "Global travel and transport provider",
        points: [
          "Cache intelligence from POC to delivery",
          "Messaging and coherence optimizations",
        ],
        tags: ["Caching", "Performance"],
      },
    ],
  },
  {
    company: "Wipro",
    role: "Project Engineer",
    period: "Sep 2015 — Jul 2018 · Bengaluru",
    items: [
      {
        title: "Building management with Haystack API",
        client: "Global semiconductor and IoT leader",
        points: ["Java API for standardized inputs and downstream operations"],
        tags: ["Spring MVC", "REST"],
      },
      {
        title: "Converged infrastructure management",
        client: "Enterprise infrastructure provider",
        points: [
          "Automation for servers and storage and networking with modern management architecture",
        ],
        tags: ["Automation", "Infrastructure"],
      },
      {
        title: "Security management system",
        client: "Global security solutions provider",
        points: ["Development and code review and vulnerability fixes"],
        tags: ["SAST", "Code review"],
      },
    ],
  },
];

const PROJECTS_DATA = [
  {
    year: 2024,
    name: "MedTech apps suite",
    badge: "Healthcare",
    desc: "Fiori UI5 apps on BTP for internal operations and faster clinical support",
    tags: ["UI5", "BTP", "OData"],
  },
  {
    year: 2022,
    name: "Cloud HR workflows",
    badge: "HRMS",
    desc: "Benefits and claims with secure OData services and launchpad integration",
    tags: ["UI5", "BTP", "Launchpad"],
  },
  {
    year: 2022,
    name: "Returns management",
    badge: "Aerospace",
    desc: "Custom UI5 returns process with CDS and OData and UAT stabilization",
    tags: ["UI5", "CDS", "WorkZone"],
  },
  {
    year: 2019,
    name: "TDM portal automation",
    badge: "Telecom",
    desc: "Microservices driven data automation and test orchestration",
    tags: ["Microservices", "React"],
  },
  {
    year: 2018,
    name: "Revenue management hardening",
    badge: "Travel",
    desc: "Security hardening and utility refactor for reliability",
    tags: ["Security", "Refactor"],
  },
  {
    year: 2018,
    name: "DC index cache",
    badge: "Performance",
    desc: "Cache intelligence and messaging optimization",
    tags: ["Caching", "Performance"],
  },
  {
    year: 2017,
    name: "Building management API",
    badge: "IoT",
    desc: "Standardized Java API for building data inputs",
    tags: ["Spring MVC", "REST"],
  },
  {
    year: 2017,
    name: "Converged infra automation",
    badge: "Infra",
    desc: "Automation for server and storage and network management",
    tags: ["Automation", "Infra"],
  },
  {
    year: 2016,
    name: "Security management system",
    badge: "Security",
    desc: "Development and vulnerability remediation",
    tags: ["SAST", "Secure SDLC"],
  },
];

const SKILLS_DATA = {
  core: [
    "SAP UI5 / Fiori",
    "CAPM (Node.js)",
    "SAP BTP",
    "OData / REST",
    "JavaScript",
    "MongoDB",
    "Git",
    "GenAI",
  ],
  tooling: [
    "SAP BAS",
    "Postman",
    "Docker",
    "Cloud Foundry",
    "Agile",
    "JIRA",
    "OpenAPI",
  ],
  soft: [
    "Mentorship",
    "Stakeholder alignment",
    "Documentation",
    "Code reviews",
    "Agile demos",
  ],
};

/* =============================================================================
   DESIGN SYSTEM
============================================================================= */

const designTokens = {
  colors: {
    bg: {
      primary: "#050507",
      secondary: "#0A0A0C",
    },
    text: {
      primary: "#FFFFFF",
      secondary: "#A1A1AA",
      tertiary: "#52525B",
    },
    border: {
      subtle: "rgba(255, 255, 255, 0.06)",
      highlight: "rgba(255, 255, 255, 0.12)",
    },
    accent: {
      primary: "#6366F1",
      whatsapp: "#25D366",
      cyan: "#22D3EE",
      emerald: "#10B981",
      amber: "#F59E0B",
      violet: "#8B5CF6",
    },
    gradient: {
      text: "linear-gradient(to right bottom, #FFFFFF 30%, #94A3B8 100%)",
      primary: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
    },
  },
  radius: {
    md: "12px",
    lg: "16px",
    xl: "24px",
    full: "9999px",
  },
};

const muiTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: designTokens.colors.accent.primary },
    background: {
      default: designTokens.colors.bg.primary,
      paper: designTokens.colors.bg.secondary,
    },
    text: {
      primary: designTokens.colors.text.primary,
      secondary: designTokens.colors.text.secondary,
    },
  },
  typography: {
    fontFamily: '"Inter", sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: { root: { borderRadius: designTokens.radius.full } },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 8,
          border: `1px solid ${designTokens.colors.border.subtle}`,
          backgroundColor: "rgba(255,255,255,0.02)",
        },
      },
    },
  },
});

/* =============================================================================
   COMPONENTS
============================================================================= */

const MotionBox = motion(Box);

const SpotlightCard = ({ children, sx, className = "", delay = 0 }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove({ currentTarget, clientX, clientY }) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <MotionBox
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay }}
      className={`group relative border border-white/10 bg-gray-900/50 overflow-hidden ${className}`}
      onMouseMove={handleMouseMove}
      sx={{
        position: "relative",
        height: "100%",
        borderRadius: designTokens.radius.xl,
        bgcolor: "rgba(255,255,255,0.02)",
        border: `1px solid ${designTokens.colors.border.subtle}`,
        textAlign: "left",
        ...sx,
      }}
    >
      <MotionBox
        style={{
          background: useMotionTemplate`
            radial-gradient(
              650px circle at ${mouseX}px ${mouseY}px,
              rgba(99, 102, 241, 0.15),
              transparent 80%
            )
          `,
        }}
        sx={{
          position: "absolute",
          inset: -1,
          opacity: 0,
          transition: "opacity 300ms",
          borderRadius: "inherit",
          zIndex: 0,
          pointerEvents: "none",
          "&:hover": { opacity: 1 },
          ".MuiBox-root:hover > &": { opacity: 1 },
        }}
      />
      <Box sx={{ position: "relative", zIndex: 10, height: "100%" }}>
        {children}
      </Box>
    </MotionBox>
  );
};

const SectionHeader = memo(({ badge, title, highlight, subtitle }) => (
  <Box sx={{ mb: { xs: 6, md: 8 }, maxWidth: 700, textAlign: "left" }}>
    {badge && (
      <MotionBox
        initial={{ opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.5,
          mb: 2,
          borderRadius: "100px",
          bgcolor: alpha(designTokens.colors.accent.primary, 0.1),
          border: `1px solid ${alpha(designTokens.colors.accent.primary, 0.2)}`,
        }}
      >
        <Typography
          sx={{
            fontSize: "0.75rem",
            fontWeight: 700,
            color: designTokens.colors.accent.primary,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {badge}
        </Typography>
      </MotionBox>
    )}
    <Typography
      variant="h2"
      sx={{
        fontSize: { xs: "2.25rem", md: "3.5rem" },
        lineHeight: 1.1,
        mb: 2,
        background: designTokens.colors.gradient.text,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {title}{" "}
      <span style={{ color: designTokens.colors.text.tertiary }}>
        {highlight}
      </span>
    </Typography>
    {subtitle && (
      <Typography
        sx={{
          fontSize: { xs: "1rem", md: "1.125rem" },
          color: designTokens.colors.text.secondary,
          maxWidth: "80%",
          lineHeight: 1.6,
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
  fullWidth,
  sx,
}) => {
  const isPrimary = variant === "primary";
  return (
    <Box
      component="a"
      href={href}
      // Only open in new tab if it's an external link or email
      target={href.startsWith("#") ? "_self" : "_blank"}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        px: 4,
        py: 1.8,
        fontSize: "0.95rem",
        fontWeight: 600,
        color: "#fff",
        background: isPrimary
          ? designTokens.colors.gradient.primary
          : "rgba(255,255,255,0.05)",
        border: isPrimary
          ? "none"
          : `1px solid ${designTokens.colors.border.highlight}`,
        borderRadius: "100px",
        cursor: "pointer",
        textDecoration: "none",
        width: fullWidth ? "100%" : "auto",
        transition: "transform 0.2s, box-shadow 0.2s",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: isPrimary
            ? "0 10px 25px -5px rgba(99, 102, 241, 0.4)"
            : "none",
          background: !isPrimary && "rgba(255,255,255,0.08)",
        },
        ...sx,
      }}
    >
      {children}
      {icon && <Box sx={{ fontSize: 20, display: "flex" }}>{icon}</Box>}
    </Box>
  );
};

/* =============================================================================
   SECTIONS
============================================================================= */

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("md"));
  const navLinks = ["About", "Skills", "Experience", "Projects", "Contact"];

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <>
      <Box
        component={motion.nav}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        sx={{
          position: "fixed",
          top: { xs: 20, md: 24 },
          left: 0,
          right: 0,
          zIndex: 1000,
          display: "flex",
          justifyContent: "center",
          px: 2,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            maxWidth: 1000,
            height: { xs: 56, md: 64 },
            px: { xs: 2, md: 4 },
            borderRadius: "100px",
            bgcolor: scrolled ? "rgba(10, 10, 12, 0.6)" : "transparent",
            backdropFilter: scrolled ? "blur(16px)" : "none",
            border: scrolled
              ? `1px solid ${designTokens.colors.border.subtle}`
              : "1px solid transparent",
            transition: "all 0.4s ease",
            boxShadow: scrolled ? "0 8px 32px rgba(0,0,0,0.2)" : "none",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar
              src={logo}
              sx={{
                width: 32,
                height: 32,
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 700 }}>
              {PROFILE_DATA.name}
            </Typography>
          </Box>
          {!isMobile && (
            <Stack direction="row" spacing={1}>
              {navLinks.map((item) => (
                <Box
                  key={item}
                  component="a"
                  href={`#${item.toLowerCase()}`}
                  sx={{
                    px: 2,
                    py: 1,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "text.secondary",
                    textDecoration: "none",
                    borderRadius: "100px",
                    transition: "all 0.2s",
                    "&:hover": {
                      color: "white",
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
                  href={PROFILE_DATA.github}
                  target="_blank"
                  sx={{
                    color: "text.secondary",
                    "&:hover": { color: "white" },
                  }}
                >
                  <GitHub fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  href={PROFILE_DATA.whatsapp}
                  target="_blank"
                  sx={{
                    color: designTokens.colors.accent.whatsapp,
                    "&:hover": { opacity: 0.8 },
                  }}
                >
                  <WhatsApp fontSize="small" />
                </IconButton>
              </>
            )}
            {isMobile && (
              <IconButton
                onClick={() => setMenuOpen(true)}
                sx={{ color: "white" }}
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
            initial={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            animate={{ opacity: 1, clipPath: "circle(150% at 100% 0%)" }}
            exit={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
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
              sx={{ position: "absolute", top: 24, right: 24, color: "white" }}
            >
              <CloseIcon />
            </IconButton>
            <Stack spacing={4} alignItems="center">
              {navLinks.map((item) => (
                <Typography
                  key={item}
                  component="a"
                  href={`#${item.toLowerCase()}`}
                  onClick={() => setMenuOpen(false)}
                  sx={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    color: "white",
                    textDecoration: "none",
                  }}
                >
                  {item}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}
      </AnimatePresence>
    </>
  );
};

const Hero = () => {
  return (
    <Box
      id="about"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        position: "relative",
        pt: { xs: 12, md: 0 },
        overflow: "hidden",
      }}
    >
      <Box
        component={motion.div}
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 10, repeat: Infinity }}
        sx={{
          position: "absolute",
          top: "-20%",
          right: "-10%",
          width: "800px",
          height: "800px",
          background:
            "radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 60%)",
          filter: "blur(80px)",
          zIndex: 0,
        }}
      />
      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        <Grid container spacing={6} alignItems="center">
          <Grid item xs={12} md={7}>
            <MotionBox
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              sx={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <Chip
                icon={
                  <RocketLaunch
                    sx={{ fontSize: "16px !important", color: "#fff" }}
                  />
                }
                label={PROFILE_DATA.currentRole}
                sx={{
                  mb: 4,
                  px: 1,
                  py: 0.5,
                  borderColor: "rgba(255,255,255,0.1)",
                }}
              />
              <Typography
                variant="h1"
                sx={{
                  fontSize: { xs: "3rem", sm: "4rem", md: "5.5rem" },
                  lineHeight: 1,
                  mb: 3,
                  letterSpacing: "-0.03em",
                  textAlign: "left",
                }}
              >
                Building the <br />
                <span
                  style={{
                    background: designTokens.colors.gradient.primary,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Digital Future
                </span>
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: "1.125rem", md: "1.25rem" },
                  color: designTokens.colors.text.secondary,
                  maxWidth: 550,
                  mb: 5,
                  lineHeight: 1.6,
                  textAlign: "left",
                }}
              >
                {PROFILE_DATA.summary}
              </Typography>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                {/* --- NAVIGATION FIX 1: View Portfolio -> #skills --- */}
                <CTAButton href="#skills" icon={<ArrowForward />}>
                  View Portfolio
                </CTAButton>
                {/* --- NAVIGATION FIX 2: Contact Me -> #contact --- */}
                <CTAButton
                  variant="secondary"
                  href="#contact"
                  icon={<MailOutline />}
                >
                  Contact Me
                </CTAButton>
              </Stack>
            </MotionBox>
          </Grid>
          <Grid
            item
            xs={12}
            md={5}
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <MotionBox
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
              sx={{ position: "relative" }}
            >
              <Box
                sx={{
                  width: { xs: 280, md: 420 },
                  height: { xs: 320, md: 500 },
                  borderRadius: "24px",
                  background: `url(${photo}) center/cover no-repeat`,
                  filter: "grayscale(100%)",
                  transition: "filter 0.5s ease",
                  "&:hover": { filter: "grayscale(0%)" },
                  position: "relative",
                  zIndex: 2,
                  boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                }}
              />
            </MotionBox>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

const Skills = () => {
  return (
    <Box id="skills" sx={{ py: 20 }}>
      <Container>
        <SectionHeader
          title="Technical"
          highlight="Expertise"
          subtitle="A curated stack of technologies I use to build scalable products."
        />
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <SpotlightCard delay={0.1}>
              <Box sx={{ p: 4, textAlign: "left" }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    bgcolor: alpha(designTokens.colors.accent.cyan, 0.1),
                    color: designTokens.colors.accent.cyan,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 3,
                  }}
                >
                  <Code />
                </Box>
                <Typography variant="h5" gutterBottom>
                  Core Stack
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {SKILLS_DATA.core.map((s) => (
                    <Chip key={s} label={s} size="small" />
                  ))}
                </Box>
              </Box>
            </SpotlightCard>
          </Grid>
          <Grid item xs={12} md={4}>
            <SpotlightCard delay={0.2}>
              <Box sx={{ p: 4, textAlign: "left" }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    bgcolor: alpha(designTokens.colors.accent.violet, 0.1),
                    color: designTokens.colors.accent.violet,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 3,
                  }}
                >
                  <RocketLaunch />
                </Box>
                <Typography variant="h5" gutterBottom>
                  Cloud & DevOps
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {SKILLS_DATA.tooling.map((s) => (
                    <Chip key={s} label={s} size="small" />
                  ))}
                </Box>
              </Box>
            </SpotlightCard>
          </Grid>
          <Grid item xs={12} md={4}>
            <SpotlightCard delay={0.3}>
              <Box sx={{ p: 4, textAlign: "left" }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    bgcolor: alpha(designTokens.colors.accent.amber, 0.1),
                    color: designTokens.colors.accent.amber,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 3,
                  }}
                >
                  <EmojiObjectsOutlined />
                </Box>
                <Typography variant="h5" gutterBottom>
                  Leadership
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {SKILLS_DATA.soft.map((s) => (
                    <Chip key={s} label={s} size="small" />
                  ))}
                </Box>
              </Box>
            </SpotlightCard>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

const Experience = () => {
  return (
    <Box id="experience" sx={{ py: 10 }}>
      <Container>
        <SectionHeader title="Professional" highlight="Journey" />
        <Box
          sx={{
            position: "relative",
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            ml: { xs: 2, md: 0 },
            pl: { xs: 4, md: 0 },
          }}
        >
          {EXPERIENCE_DATA.map((job, index) => (
            <MotionBox
              key={index}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              sx={{
                mb: 8,
                ml: { md: 6 },
                position: "relative",
                textAlign: "left",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  left: { xs: -38, md: -55 },
                  top: 6,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: designTokens.colors.accent.primary,
                  boxShadow: `0 0 0 4px ${designTokens.colors.bg.primary}`,
                }}
              />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                alignItems="baseline"
                justifyContent="space-between"
                mb={1}
              >
                <Typography variant="h4" sx={{ fontSize: "1.5rem" }}>
                  {job.role}
                </Typography>
                <Typography sx={{ color: "text.secondary" }}>
                  {job.period}
                </Typography>
              </Stack>
              <Typography
                variant="h6"
                color="primary"
                sx={{ mb: 3, fontSize: "1.1rem" }}
              >
                {job.company}
              </Typography>
              <Stack spacing={2}>
                {job.items &&
                  job.items.map((item, i) => (
                    <SpotlightCard key={i} sx={{ p: 3, textAlign: "left" }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        mb={1}
                      >
                        <Typography
                          variant="h6"
                          sx={{ fontSize: "1rem", textAlign: "left" }}
                        >
                          {item.title}
                        </Typography>
                        {item.client && (
                          <Chip
                            label={item.client}
                            size="small"
                            icon={<StarRounded style={{ fontSize: 14 }} />}
                          />
                        )}
                      </Stack>
                      <Box
                        component="ul"
                        sx={{
                          pl: 2,
                          m: 0,
                          color: designTokens.colors.text.secondary,
                          textAlign: "left",
                        }}
                      >
                        {item.points.map((pt, idx) => (
                          <Typography
                            component="li"
                            key={idx}
                            variant="body2"
                            sx={{ mb: 0.5, textAlign: "left" }}
                          >
                            {pt}
                          </Typography>
                        ))}
                      </Box>
                    </SpotlightCard>
                  ))}
              </Stack>
            </MotionBox>
          ))}
        </Box>
      </Container>
    </Box>
  );
};

const Projects = () => {
  return (
    <Box id="projects" sx={{ py: 20, bgcolor: "rgba(255,255,255,0.01)" }}>
      <Container>
        <SectionHeader
          title="Featured"
          highlight="Work"
          subtitle="Highlights from my development career."
        />
        <Grid container spacing={4} alignItems="stretch">
          {PROJECTS_DATA.map((p, i) => (
            <Grid item xs={12} md={6} key={i} sx={{ display: "flex" }}>
              <SpotlightCard
                delay={i * 0.1}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  height: "100%",
                  textAlign: "left",
                }}
              >
                <Box
                  sx={{
                    p: 4,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    textAlign: "left",
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" mb={3}>
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        bgcolor: "rgba(255,255,255,0.05)",
                      }}
                    >
                      <Code fontSize="small" />
                    </Box>
                    <Chip label={p.year} size="small" sx={{ height: 24 }} />
                  </Stack>
                  <Typography
                    variant="h5"
                    gutterBottom
                    sx={{ textAlign: "left", minHeight: "3rem" }}
                  >
                    {p.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mb: 4,
                      flexGrow: 1,
                      lineHeight: 1.7,
                      textAlign: "left",
                    }}
                  >
                    {p.desc}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {p.tags.map((t) => (
                      <Typography
                        key={t}
                        variant="caption"
                        sx={{
                          color: designTokens.colors.accent.primary,
                          fontWeight: 600,
                        }}
                      >
                        #{t}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              </SpotlightCard>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};

const Contact = () => {
  return (
    <Box id="contact" sx={{ py: 20, position: "relative" }}>
      <Container maxWidth="md" sx={{ textAlign: "center" }}>
        <Typography
          variant="h2"
          sx={{ fontSize: { xs: "2.5rem", md: "4rem" }, mb: 2 }}
        >
          Let's Work Together
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ mb: 6, fontSize: "1.2rem", maxWidth: 600, mx: "auto" }}
        >
          I'm currently available for new opportunities. Whether you have a
          question or just want to say hi, I'll try my best to get back to you!
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="center"
          alignItems="center"
          spacing={{ xs: 3, sm: 6 }}
          sx={{ mb: 6 }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MailOutline sx={{ color: "text.secondary" }} />
            <Link
              href={`mailto:${PROFILE_DATA.email}`}
              underline="hover"
              color="text.primary"
              sx={{ fontSize: "1rem", fontWeight: 500 }}
            >
              {PROFILE_DATA.email}
            </Link>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Phone sx={{ color: "text.secondary" }} />
            <Typography sx={{ fontSize: "1rem", fontWeight: 500 }}>
              {PROFILE_DATA.whatsappNumber}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <LocationOn sx={{ color: "text.secondary" }} />
            <Typography sx={{ fontSize: "1rem", fontWeight: 500 }}>
              {PROFILE_DATA.location}
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            gap: 2,
            flexWrap: "wrap",
            mb: 8,
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
            href={PROFILE_DATA.whatsapp}
            icon={<WhatsApp />}
            sx={{
              borderColor: alpha(designTokens.colors.accent.whatsapp, 0.3),
              color: designTokens.colors.accent.whatsapp,
              "&:hover": {
                borderColor: designTokens.colors.accent.whatsapp,
                bgcolor: alpha(designTokens.colors.accent.whatsapp, 0.05),
                boxShadow: `0 0 20px ${alpha(
                  designTokens.colors.accent.whatsapp,
                  0.2
                )}`,
              },
            }}
          >
            WhatsApp
          </CTAButton>
        </Box>

        <Box
          sx={{
            pt: 8,
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            color: "text.secondary",
          }}
        >
          <Typography variant="body2">
            © {new Date().getFullYear()} {PROFILE_DATA.name}.
          </Typography>
          <Stack direction="row" spacing={3}>
            <Typography
              variant="body2"
              component="a"
              href="#"
              sx={{ color: "inherit", textDecoration: "none" }}
            >
              Back to Top
            </Typography>
          </Stack>
        </Box>
      </Container>
    </Box>
  );
};

export default function TCSinterviewAssistantAI() {
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          html { scroll-behavior: smooth; }
          body { 
            background-color: ${designTokens.colors.bg.primary};
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.05'/%3E%3C/svg%3E");
          }
          ::selection { background: ${alpha(
            designTokens.colors.accent.primary,
            0.3
          )}; color: white; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #333; borderRadius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: #555; }
        `}
      />
      <Navbar />
      <main>
        <Hero />
        <Skills />
        <Experience />
        <Projects />
        <Contact />
      </main>
    </ThemeProvider>
  );
}
