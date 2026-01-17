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
import { motion, AnimatePresence } from "framer-motion";

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
  currentRole: "SAP BTP, UI5, FIORI Consultant",
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
      primary: "#0A0A0B",
      card: "#111113",
      cardHover: "#161618",
      elevated: "#1A1A1D",
    },
    text: {
      primary: "#FFFFFF",
      secondary: "#B4B4B4",
      tertiary: "#888888",
      muted: "#666666",
    },
    border: {
      card: "#222225",
      hover: "#333336",
      accent: "#3B3B3F",
    },
    accent: {
      primary: "#10B981",
      secondary: "#3B82F6",
      whatsapp: "#25D366",
      gold: "#F59E0B",
    },
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    full: "9999px",
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
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    h1: { fontWeight: 700, letterSpacing: "-0.02em" },
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
          fontSize: "0.75rem",
          borderRadius: designTokens.radius.sm,
          border: `1px solid ${designTokens.colors.border.card}`,
          backgroundColor: designTokens.colors.bg.card,
        },
      },
    },
  },
});

/* =============================================================================
   COMPONENTS
============================================================================= */

const MotionBox = motion(Box);

const Card = ({ children, sx, delay = 0 }) => (
  <MotionBox
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-50px" }}
    transition={{ duration: 0.4, delay, ease: "easeOut" }}
    sx={{
      bgcolor: designTokens.colors.bg.card,
      border: `1px solid ${designTokens.colors.border.card}`,
      borderRadius: designTokens.radius.lg,
      transition: "all 0.25s ease",
      height: "100%",
      "&:hover": {
        bgcolor: designTokens.colors.bg.cardHover,
        borderColor: designTokens.colors.border.hover,
        transform: "translateY(-2px)",
      },
      ...sx,
    }}
  >
    {children}
  </MotionBox>
);

const SectionHeader = memo(({ badge, title, subtitle }) => (
  <Box sx={{ mb: { xs: 5, md: 6 }, textAlign: "left" }}>
    {badge && (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 0.75,
          mb: 2,
          borderRadius: designTokens.radius.full,
          bgcolor: alpha(designTokens.colors.accent.primary, 0.1),
          border: `1px solid ${alpha(designTokens.colors.accent.primary, 0.25)}`,
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: designTokens.colors.accent.primary,
          }}
        />
        <Typography
          sx={{
            fontSize: "0.7rem",
            fontWeight: 700,
            color: designTokens.colors.accent.primary,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {badge}
        </Typography>
      </Box>
    )}
    <Typography
      variant="h2"
      sx={{
        fontSize: { xs: "1.75rem", sm: "2.25rem", md: "2.75rem" },
        lineHeight: 1.2,
        mb: 1.5,
        color: "#FFF",
      }}
    >
      {title}
    </Typography>
    {subtitle && (
      <Typography
        sx={{
          fontSize: { xs: "0.9rem", md: "1rem" },
          color: designTokens.colors.text.tertiary,
          maxWidth: 550,
          lineHeight: 1.6,
        }}
      >
        {subtitle}
      </Typography>
    )}
  </Box>
));

const CTAButton = ({ children, variant = "primary", href, icon, sx }) => {
  const isPrimary = variant === "primary";
  return (
    <Box
      component="a"
      href={href}
      target={href.startsWith("#") ? "_self" : "_blank"}
      rel="noopener noreferrer"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        px: { xs: 2.5, md: 3.5 },
        py: { xs: 1.25, md: 1.4 },
        fontSize: { xs: "0.85rem", md: "0.9rem" },
        fontWeight: 600,
        color: isPrimary ? "#0A0A0B" : "#FFF",
        bgcolor: isPrimary ? "#FFF" : "transparent",
        border: isPrimary ? "none" : `1px solid ${designTokens.colors.border.hover}`,
        borderRadius: designTokens.radius.full,
        cursor: "pointer",
        textDecoration: "none",
        transition: "all 0.2s ease",
        "&:hover": {
          transform: "translateY(-1px)",
          bgcolor: isPrimary ? "#F0F0F0" : designTokens.colors.bg.card,
        },
        ...sx,
      }}
    >
      {children}
      {icon && <Box sx={{ fontSize: 18, display: "flex" }}>{icon}</Box>}
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
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

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
          bgcolor: scrolled ? "rgba(10, 10, 11, 0.95)" : "transparent",
          backdropFilter: scrolled ? "blur(12px)" : "none",
          borderBottom: scrolled ? `1px solid ${designTokens.colors.border.card}` : "none",
          transition: "all 0.3s ease",
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar
              src={logo}
              sx={{
                width: 36,
                height: 36,
                border: `1px solid ${designTokens.colors.border.card}`,
              }}
            />
            <Typography sx={{ fontSize: "1rem", fontWeight: 700, color: "#FFF" }}>
              {PROFILE_DATA.name.split(" ")[0]}
            </Typography>
          </Box>

          {!isMobile && (
            <Stack direction="row" spacing={1} sx={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
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
                    transition: "all 0.2s ease",
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
                  href={PROFILE_DATA.github}
                  target="_blank"
                  sx={{ color: designTokens.colors.text.tertiary, "&:hover": { color: "#FFF" } }}
                >
                  <GitHub sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  href={PROFILE_DATA.whatsapp}
                  target="_blank"
                  sx={{ color: designTokens.colors.accent.whatsapp, "&:hover": { opacity: 0.8 } }}
                >
                  <WhatsApp sx={{ fontSize: 20 }} />
                </IconButton>
              </>
            )}
            {isMobile && (
              <IconButton onClick={() => setMenuOpen(true)} sx={{ color: "#FFF" }}>
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
            transition={{ duration: 0.2 }}
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
              {navLinks.map((item) => (
                <Typography
                  key={item}
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

  return (
    <Box
      id="about"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        pt: { xs: 12, md: 10 },
        pb: { xs: 6, md: 0 },
      }}
    >
      <Container maxWidth="lg">
        {/* Desktop/Laptop: Side by side layout */}
        {!isMobile ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            {/* Left: Text Content */}
            <Box sx={{ flex: 1, maxWidth: 600 }}>
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
                sx={{ mb: 3 }}
              />

              <Typography
                variant="h1"
                sx={{
                  fontSize: { md: "3rem", lg: "3.75rem", xl: "4.25rem" },
                  lineHeight: 1.1,
                  mb: 2.5,
                  color: "#FFF",
                }}
              >
                Building the{" "}
                <Box
                  component="span"
                  sx={{
                    background: `linear-gradient(135deg, ${designTokens.colors.accent.primary} 0%, ${designTokens.colors.accent.secondary} 100%)`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Digital Future
                </Box>
              </Typography>

              <Typography
                sx={{
                  fontSize: "1.05rem",
                  color: designTokens.colors.text.secondary,
                  maxWidth: 500,
                  mb: 4,
                  lineHeight: 1.7,
                }}
              >
                {PROFILE_DATA.summary}
              </Typography>

              <Stack direction="row" spacing={2}>
                <CTAButton href="#skills" icon={<ArrowForward />}>
                  View Portfolio
                </CTAButton>
                <CTAButton variant="secondary" href="#contact" icon={<MailOutline />}>
                  Contact Me
                </CTAButton>
              </Stack>
            </Box>

            {/* Right: Photo */}
            <Box
              sx={{
                flexShrink: 0,
                width: { md: 280, lg: 320, xl: 360 },
                height: { md: 350, lg: 400, xl: 450 },
                borderRadius: designTokens.radius.xl,
                overflow: "hidden",
                border: `1px solid ${designTokens.colors.border.card}`,
                boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
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
                  filter: "grayscale(100%)",
                  transition: "filter 0.4s ease",
                  "&:hover": { filter: "grayscale(0%)" },
                }}
              />
            </Box>
          </Box>
        ) : (
          /* Mobile: Stacked layout with photo on top */
          <Box sx={{ textAlign: "center" }}>
            {/* Photo */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                mb: 4,
              }}
            >
              <Box
                sx={{
                  width: 200,
                  height: 260,
                  borderRadius: designTokens.radius.xl,
                  overflow: "hidden",
                  border: `1px solid ${designTokens.colors.border.card}`,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
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
                    filter: "grayscale(100%)",
                    transition: "filter 0.4s ease",
                    "&:hover": { filter: "grayscale(0%)" },
                  }}
                />
              </Box>
            </Box>

            {/* Text Content */}
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
              sx={{ mb: 3 }}
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
                  background: `linear-gradient(135deg, ${designTokens.colors.accent.primary} 0%, ${designTokens.colors.accent.secondary} 100%)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Digital Future
              </Box>
            </Typography>

            <Typography
              sx={{
                fontSize: "0.95rem",
                color: designTokens.colors.text.secondary,
                mb: 4,
                lineHeight: 1.7,
                px: 1,
              }}
            >
              {PROFILE_DATA.summary}
            </Typography>

            <Stack direction="column" spacing={2} alignItems="center">
              <CTAButton href="#skills" icon={<ArrowForward />} sx={{ width: "100%", maxWidth: 280 }}>
                View Portfolio
              </CTAButton>
              <CTAButton variant="secondary" href="#contact" icon={<MailOutline />} sx={{ width: "100%", maxWidth: 280 }}>
                Contact Me
              </CTAButton>
            </Stack>
          </Box>
        )}
      </Container>
    </Box>
  );
};

const Skills = () => {
  const categories = [
    { title: "Core Stack", icon: <Code />, color: designTokens.colors.accent.secondary, skills: SKILLS_DATA.core },
    { title: "Cloud & DevOps", icon: <RocketLaunch />, color: designTokens.colors.accent.primary, skills: SKILLS_DATA.tooling },
    { title: "Leadership", icon: <EmojiObjectsOutlined />, color: designTokens.colors.accent.gold, skills: SKILLS_DATA.soft },
  ];

  return (
    <Box id="skills" sx={{ py: { xs: 8, md: 12 } }}>
      <Container maxWidth="lg">
        <SectionHeader
          badge="Expertise"
          title="Technical Proficiency"
          subtitle="Technologies I use to build scalable enterprise products."
        />
        <Grid container spacing={2.5}>
          {categories.map((cat, i) => (
            <Grid item xs={12} md={4} key={cat.title}>
              <Card delay={i * 0.1}>
                <Box sx={{ p: 3 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: designTokens.radius.md,
                      bgcolor: alpha(cat.color, 0.12),
                      color: cat.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      mb: 2.5,
                    }}
                  >
                    {cat.icon}
                  </Box>
                  <Typography sx={{ mb: 2, fontSize: "1.1rem", fontWeight: 600, color: "#FFF" }}>
                    {cat.title}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {cat.skills.map((s) => (
                      <Chip
                        key={s}
                        label={s}
                        size="small"
                        sx={{
                          bgcolor: designTokens.colors.bg.elevated,
                          color: designTokens.colors.text.secondary,
                          borderColor: designTokens.colors.border.card,
                          fontSize: "0.75rem",
                          height: 28,
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
  <Box id="experience" sx={{ py: { xs: 8, md: 12 } }}>
    <Container maxWidth="lg">
      <SectionHeader
        badge="Journey"
        title="Professional Experience"
        subtitle="A decade of building enterprise solutions across global organizations."
      />

      <Stack spacing={5}>
        {EXPERIENCE_DATA.map((job, jobIndex) => (
          <Box key={jobIndex}>
            <Box sx={{ mb: 2.5 }}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={0.5}
                sx={{ mb: 0.5 }}
              >
                <Typography sx={{ fontSize: { xs: "1.2rem", md: "1.35rem" }, fontWeight: 600, color: "#FFF" }}>
                  {job.role}
                </Typography>
                <Typography sx={{ color: designTokens.colors.text.muted, fontSize: "0.85rem", fontWeight: 500 }}>
                  {job.period}
                </Typography>
              </Stack>
              <Typography sx={{ color: designTokens.colors.accent.primary, fontSize: "0.95rem", fontWeight: 600 }}>
                {job.company}
              </Typography>
            </Box>

            <Grid container spacing={2}>
              {job.items.map((item, i) => (
                <Grid item xs={12} sm={6} key={i}>
                  <Card delay={i * 0.05}>
                    <Box sx={{ p: 2.5 }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="flex-start"
                        spacing={1}
                        sx={{ mb: 1.5 }}
                      >
                        <Typography sx={{ fontSize: "0.95rem", fontWeight: 600, color: "#FFF", lineHeight: 1.4, flex: 1 }}>
                          {item.title}
                        </Typography>
                        {item.client && (
                          <Chip
                            label={item.client}
                            size="small"
                            icon={<StarRounded sx={{ fontSize: "12px !important", color: `${designTokens.colors.accent.gold} !important` }} />}
                            sx={{
                              flexShrink: 0,
                              maxWidth: 180,
                              bgcolor: alpha(designTokens.colors.accent.gold, 0.1),
                              borderColor: alpha(designTokens.colors.accent.gold, 0.25),
                              color: designTokens.colors.accent.gold,
                              fontSize: "0.65rem",
                              height: 24,
                              "& .MuiChip-label": { px: 1 },
                              "& .MuiChip-icon": { ml: 0.5 },
                            }}
                          />
                        )}
                      </Stack>
                      <Box
                        component="ul"
                        sx={{
                          m: 0,
                          pl: 2,
                          "& li": {
                            color: designTokens.colors.text.secondary,
                            fontSize: "0.85rem",
                            mb: 0.5,
                            lineHeight: 1.5,
                            "&::marker": { color: designTokens.colors.border.accent },
                          },
                        }}
                      >
                        {item.points.map((pt, idx) => (
                          <li key={idx}>{pt}</li>
                        ))}
                      </Box>
                    </Box>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        ))}
      </Stack>
    </Container>
  </Box>
);

const Projects = () => (
  <Box id="projects" sx={{ py: { xs: 8, md: 12 }, bgcolor: designTokens.colors.bg.card }}>
    <Container maxWidth="lg">
      <SectionHeader
        badge="Portfolio"
        title="Featured Work"
        subtitle="Highlights from a decade of delivering enterprise solutions."
      />

      <Grid container spacing={2}>
        {PROJECTS_DATA.map((p, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Card delay={i * 0.05} sx={{ bgcolor: designTokens.colors.bg.primary }}>
              <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", height: "100%", minHeight: 200 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: designTokens.radius.sm,
                      bgcolor: designTokens.colors.bg.elevated,
                      border: `1px solid ${designTokens.colors.border.card}`,
                      color: designTokens.colors.text.tertiary,
                    }}
                  >
                    <Code sx={{ fontSize: 18 }} />
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      label={p.badge}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.6rem",
                        fontWeight: 600,
                        bgcolor: alpha(designTokens.colors.accent.secondary, 0.12),
                        borderColor: alpha(designTokens.colors.accent.secondary, 0.25),
                        color: designTokens.colors.accent.secondary,
                      }}
                    />
                    <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: designTokens.colors.text.muted }}>
                      {p.year}
                    </Typography>
                  </Stack>
                </Stack>

                <Typography sx={{ fontSize: "1rem", fontWeight: 600, color: "#FFF", mb: 1, lineHeight: 1.3 }}>
                  {p.name}
                </Typography>

                <Typography sx={{ fontSize: "0.85rem", color: designTokens.colors.text.tertiary, lineHeight: 1.55, flexGrow: 1, mb: 2 }}>
                  {p.desc}
                </Typography>

                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {p.tags.map((t) => (
                    <Typography
                      key={t}
                      sx={{
                        fontSize: "0.7rem",
                        fontWeight: 500,
                        color: designTokens.colors.text.muted,
                      }}
                    >
                      #{t}
                    </Typography>
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
  <Box id="contact" sx={{ py: { xs: 8, md: 12 } }}>
    <Container maxWidth="md" sx={{ textAlign: "center" }}>
      <Typography
        variant="h2"
        sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem", md: "2.75rem" }, mb: 2, color: "#FFF" }}
      >
        Let's Work{" "}
        <Box
          component="span"
          sx={{
            background: `linear-gradient(135deg, ${designTokens.colors.accent.primary}, ${designTokens.colors.accent.secondary})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Together
        </Box>
      </Typography>

      <Typography
        sx={{
          mb: 5,
          fontSize: { xs: "0.9rem", md: "1rem" },
          maxWidth: 450,
          mx: "auto",
          color: designTokens.colors.text.tertiary,
          lineHeight: 1.6,
        }}
      >
        Currently available for new opportunities. Whether you have a question or just want to connect, I'd love to hear from you.
      </Typography>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="center"
        alignItems="center"
        spacing={{ xs: 2, sm: 4 }}
        sx={{ mb: 5 }}
      >
        {[
          { icon: <MailOutline sx={{ fontSize: 18 }} />, text: PROFILE_DATA.email, href: `mailto:${PROFILE_DATA.email}` },
          { icon: <Phone sx={{ fontSize: 18 }} />, text: PROFILE_DATA.whatsappNumber },
          { icon: <LocationOn sx={{ fontSize: 18 }} />, text: PROFILE_DATA.location },
        ].map((item, i) => (
          <Box
            key={i}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: designTokens.colors.text.secondary,
            }}
          >
            <Box sx={{ color: designTokens.colors.text.muted }}>{item.icon}</Box>
            {item.href ? (
              <Link
                href={item.href}
                underline="hover"
                sx={{ color: "inherit", fontSize: "0.85rem", fontWeight: 500 }}
              >
                {item.text}
              </Link>
            ) : (
              <Typography sx={{ fontSize: "0.85rem", fontWeight: 500 }}>{item.text}</Typography>
            )}
          </Box>
        ))}
      </Stack>

      <Box sx={{ display: "flex", justifyContent: "center", gap: 1.5, flexWrap: "wrap", mb: 8 }}>
        <CTAButton href={`mailto:${PROFILE_DATA.email}`} icon={<MailOutline />}>
          Say Hello
        </CTAButton>
        <CTAButton variant="secondary" href={PROFILE_DATA.linkedin} icon={<LinkedIn />}>
          LinkedIn
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
            },
          }}
        >
          WhatsApp
        </CTAButton>
      </Box>

      <Box
        sx={{
          pt: 4,
          borderTop: `1px solid ${designTokens.colors.border.card}`,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <Typography sx={{ color: designTokens.colors.text.muted, fontSize: "0.8rem" }}>
          © {new Date().getFullYear()} {PROFILE_DATA.name}
        </Typography>
        <Box
          component="a"
          href="#about"
          sx={{
            color: designTokens.colors.text.muted,
            textDecoration: "none",
            fontSize: "0.8rem",
            "&:hover": { color: designTokens.colors.text.secondary },
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
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
          
          * { box-sizing: border-box; }
          
          html { 
            scroll-behavior: smooth; 
            scroll-padding-top: 70px;
          }
          
          body { 
            background-color: #0A0A0B;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          ::selection { 
            background: rgba(16, 185, 129, 0.3); 
            color: #FFF; 
          }
          
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #0A0A0B; }
          ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: #444; }
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