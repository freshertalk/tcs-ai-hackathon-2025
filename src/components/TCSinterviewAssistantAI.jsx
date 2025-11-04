// src/TCSinterviewAssistantAI.jsx
// React 18 + MUI 5 + Framer Motion — Single-page, smooth-scroll portfolio for Vinay Kumar Tiwari
// Redesign highlights:
// - Crisp header with active section highlight, logo at src/assets/logo.avif
// - Apple-style hero with big circular photo (src/assets/vinay.png) on left
// - Ribbon: "AI Enthusiastic in Project Implementation" prominently shown
// - Clients anonymized across Experience
// - Projects in strict reverse chronological order
// - Contact section redesigned (was "Direct")
// - Removed skills: Java / Spring Boot, Compose, Jest/JUnit/Mockito, HPE Fortify (SAST)
// - Professional animations (respects prefers-reduced-motion), mobile-first, accessible
// - Footer note italicized: Developed by Vinay Kumar Tiwari
// - Inter font via Google Fonts
// - Extras: scroll progress bar, section-aware nav, reduced-motion safe variants, focus-visible styles

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Divider,
  Grid,
  IconButton,
  Link as MuiLink,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  createTheme,
  ThemeProvider,
  useTheme,
  Tooltip,
  GlobalStyles,
} from "@mui/material";
import {
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  LinkedIn,
  MailOutline,
  Phone,
  LocationOn,
  ArrowDownward,
  ArrowUpward,
  SecurityOutlined,
  VerifiedOutlined,
  WorkspacePremiumOutlined,
  StarBorderRounded,
  RocketLaunchOutlined,
  DevicesOtherOutlined,
  TimelineOutlined,
  HubOutlined,
  LanguageOutlined,
  CodeOutlined,
  WorkHistoryOutlined,
  SchoolOutlined,
  EmojiEventsOutlined,
  EmojiObjectsOutlined,
} from "@mui/icons-material";
import { motion, useReducedMotion } from "framer-motion";
import logo from "../assets/logo.avif";
import photo from "../assets/v.avif";

// ---------- Theme ----------
const buildTheme = (mode) =>
  createTheme({
    palette: {
      mode,
      primary: { main: "#2563EB" },
      secondary: { main: "#10B981" },
      background:
        mode === "dark"
          ? { default: "#0B0F1A", paper: "#0F1524" }
          : { default: "#F7F9FC", paper: "#FFFFFF" },
    },
    shape: { borderRadius: 16 },
    typography: {
      fontFamily:
        "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      h1: { fontWeight: 800, letterSpacing: "-0.02em" },
      h2: { fontWeight: 800, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700 },
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 700 },
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiLink: { defaultProps: { underline: "hover" } },
      MuiCssBaseline: {
        styleOverrides: {
          ":root": { colorScheme: mode },
          "html, body, #root": { height: "100%" },
          "a:focus-visible, button:focus-visible": {
            outline: `3px solid ${mode === "dark" ? "#8ab4f8" : "#2563EB"}`,
            outlineOffset: 2,
            borderRadius: 8,
          },
          "::-moz-selection": { background: "#bfdbfe" },
          "::selection": { background: "#bfdbfe" },
        },
      },
    },
  });

// ---------- Animations ----------
const makeMotion = (reduce) => {
  const base = reduce
    ? { transition: { duration: 0, ease: "linear" } }
    : { transition: { duration: 0.6, ease: "easeOut" } };
  return {
    fadeUp: {
      hidden: { opacity: 0, y: reduce ? 0 : 18 },
      visible: { opacity: 1, y: 0, ...base },
    },
    fade: {
      hidden: { opacity: 0 },
      visible: { opacity: 1, ...base },
    },
    hoverLift: reduce
      ? {}
      : { whileHover: { y: -4, boxShadow: "0 10px 30px rgba(0,0,0,.12)" } },
  };
};

// ---------- Data ----------
const PROFILE = {
  name: "Vinay Kumar Tiwari",
  title:
    "Senior Software Developer (10+ yrs) — SAP UI5 / FIORI / CAPM / BTP / GenAI Engineer",
  ribbon: "AI Enthusiastic in Project Implementation",
  currentRole:
    "Assistant Consultant — Tata Consultancy Services (Aug 2022 — Present)",
  location: "Varanasi, Uttar Pradesh, India",
  phone: "+91 95615 20911",
  email: "vinaytiwari.java@gmail.com",
  linkedin: "https://www.linkedin.com/in/vktiwari/",
  summary:
    "Pragmatic engineer building scalable SAP BTP apps with SAP UI/UX excellence and secure CAP (Node.js) services, integrating GenAI where it measurably improves outcomes",
};

const SKILLS = {
  core: [
    "SAP UI5 / Fiori",
    "CAP (Node.js)",
    "SAP BTP / Cloud Foundry",
    "OData / REST",
    "JavaScript (ES2023)",
    "HTML5 / CSS3",
    "MongoDB",
    "Git / GitHub",
    "GenAI / Prompt Engineering",
  ],
  tooling: [
    "SAP BAS / WebIDE",
    "OpenAPI / Swagger",
    "Postman",
    "Docker",
    "Cloud Foundry",
    "Agile (Scrum/XP)",
    "Confluence / JIRA",
  ],
  soft: ["Mentorship", "Stakeholder alignment", "Documentation", "Code reviews", "Agile demos"],
};

const CERTS = [
  "SAP Certified Development Associate — Fiori Application Developer (C_FIORDEV_21)",
  "SAP Certified Development Associate — Extension Suite (C_CPE_12)",
  "IBM Agile Explorer, Cognitive Practitioner, Design Thinking Practitioner",
  "IBM (Coursera) — Microservices Fundamentals",
  "CDAC Pune — Advanced Computing (6 months)",
];

const EDUCATION = {
  degree: "B.E. — Electronics & Communication Engineering",
  institute: "RGPV, Bhopal",
  year: "2014",
  score: "74.90%",
};

// Experience (clients anonymized)
const EXPERIENCE = [
  {
    company: "Tata Consultancy Services",
    role: "Assistant Consultant",
    period: "Aug 2022 — Present · Varanasi",
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

const PROJECTS = [
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
].sort((a, b) => b.year - a.year);

const AWARDS = [
  "TCS Gems and multiple account recognitions",
  "Best team award and service and commit awards",
  "Growth award 2022 Q1 with cash award",
  "Recognition eCards for consistent delivery",
  "Victory League recognition at Wipro",
];

// ---------- Utilities ----------
const useInterFont = () => {
  useEffect(() => {
    const id = "inter-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(link);
    }
  }, []);
};

const Section = React.forwardRef(function Section({ id, children, ...rest }, ref) {
  return (
    <Box
      id={id}
      ref={ref}
      component="section"
      sx={{ scrollMarginTop: 96, py: { xs: 8, md: 12 } }}
      {...rest}
    >
      {children}
    </Box>
  );
});

const Card = ({ children, sx }) => {
  const reduce = useReducedMotion();
  const { fadeUp } = makeMotion(reduce);
  const hoverLift = makeMotion(reduce).hoverLift;
  return (
    <Paper
      component={motion.div}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      elevation={0}
      sx={{
        p: { xs: 3, md: 4 },
        border: (t) => `1px solid ${t.palette.divider}`,
        borderRadius: 4,
        ...sx,
      }}
      {...hoverLift}
    >
      {children}
    </Paper>
  );
};

// scroll spy
const useScrollSpy = (ids) => {
  const [active, setActive] = useState(ids[0]);
  const observer = useRef(null);
  useEffect(() => {
    const options = { root: null, rootMargin: "0px 0px -65% 0px", threshold: 0.1 };
    const handler = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    };
    observer.current = new IntersectionObserver(handler, options);
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.current.observe(el);
    });
    return () => observer.current && observer.current.disconnect();
  }, [ids]);
  return active;
};

// progress
const useScrollProgress = () => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop;
      const height = h.scrollHeight - h.clientHeight;
      setProgress(height ? Math.min(100, Math.max(0, (scrolled / height) * 100)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return progress;
};

// ---------- Main ----------
export default function TCSinterviewAssistantAI() {
  useInterFont();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [mode, setMode] = useState(prefersDark ? "dark" : "light");
  useEffect(() => setMode(prefersDark ? "dark" : "light"), [prefersDark]);
  const theme = useMemo(() => buildTheme(mode), [mode]);

  const navIds = ["about", "skills", "experience", "projects", "certs", "awards", "contact"];
  const activeId = useScrollSpy(navIds);
  const progress = useScrollProgress();

  const reduce = useReducedMotion();
  const { fade, fadeUp } = makeMotion(reduce);

  const scrollTo = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { scrollBehavior: "smooth" },
          "@media (prefers-reduced-motion: reduce)": { html: { scrollBehavior: "auto" } },
        }}
      />

      {/* Header with links and logo */}
      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        component={motion.header}
        variants={fade}
        initial="hidden"
        animate="visible"
        sx={{
          backdropFilter: "saturate(140%) blur(10px)",
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
        }}
      >
        <Toolbar component="nav" aria-label="Primary">
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
            <Avatar alt="Logo" src={logo} sx={{ width: 28, height: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Vinay{" "}
              <Box component="span" sx={{ color: "primary.main" }}>
                Tiwari
              </Box>
            </Typography>
            <Chip
              size="small"
              label={PROFILE.ribbon}
              color="primary"
              variant="outlined"
              sx={{ ml: 1, display: { xs: "none", sm: "inline-flex" } }}
              icon={<EmojiObjectsOutlined />}
              aria-label="AI Enthusiastic in Project Implementation"
            />
          </Stack>

          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ display: { xs: "none", md: "flex" }, mr: 1 }}
          >
            {[
              ["About", "about"],
              ["Skills", "skills"],
              ["Experience", "experience"],
              ["Projects", "projects"],
              ["Certifications", "certs"],
              ["Awards", "awards"],
              ["Contact", "contact"],
            ].map(([label, id]) => (
              <NavLink key={id} label={label} active={activeId === id} onClick={() => scrollTo(id)} />
            ))}
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="LinkedIn">
              <IconButton
                component={MuiLink}
                href={PROFILE.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open LinkedIn profile"
              >
                <LinkedIn />
              </IconButton>
            </Tooltip>
            <Tooltip title="Send email">
              <IconButton
                component={MuiLink}
                href={`mailto:${PROFILE.email}`}
                aria-label="Send email"
              >
                <MailOutline />
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === "dark" ? "Switch to light" : "Switch to dark"}>
              <IconButton
                onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
                aria-label="Toggle theme"
              >
                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
        {/* Scroll progress bar */}
        <LinearProgress
          variant="determinate"
          value={progress}
          aria-label="Scroll progress"
          sx={{
            height: 3,
            "& .MuiLinearProgress-bar": { transition: reduce ? "none" : "transform .2s ease" },
          }}
        />
      </AppBar>

      {/* Hero */}
      <Box
        component={motion.section}
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        sx={{
          py: { xs: 8, md: 12 },
          background: (t) =>
            mode === "dark"
              ? `linear-gradient(180deg, rgba(37,99,235,.10), transparent 40%), radial-gradient(1000px 500px at 100% -10%, rgba(37,99,235,.18), transparent 60%), ${t.palette.background.default}`
              : `linear-gradient(180deg, rgba(37,99,235,.06), transparent 40%), radial-gradient(1000px 500px at 100% -10%, rgba(37,99,235,.14), transparent 60%), ${t.palette.background.default}`,
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={5}>
              <HeroPhoto />
            </Grid>
            <Grid item xs={12} md={7}>
              <Stack spacing={2}>
                <Typography
                  variant="overline"
                  color="primary"
                  sx={{ letterSpacing: ".14em", fontWeight: 800 }}
                >
                  {PROFILE.currentRole}
                </Typography>
                <Typography component="h1" variant="h2">
                  {PROFILE.title}
                </Typography>
                <Typography variant="h6" color="text.secondary">
                  {PROFILE.summary}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    label="SAP Certified (FIORDEV_21, C_CPE_12)"
                    color="primary"
                    variant="outlined"
                    icon={<VerifiedOutlined />}
                  />
                  <Chip label="Microservices and APIs" variant="outlined" icon={<HubOutlined />} />
                  <Chip label="Security by default" variant="outlined" icon={<SecurityOutlined />} />
                  <Chip label="Observability" variant="outlined" icon={<TimelineOutlined />} />
                </Stack>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} pt={1}>
                  <Button
                    size="large"
                    variant="contained"
                    onClick={() => scrollTo("projects")}
                    endIcon={<ArrowDownward />}
                  >
                    View Projects
                  </Button>
                  <Button
                    size="large"
                    variant="outlined"
                    color="inherit"
                    onClick={() => scrollTo("contact")}
                  >
                    Contact
                  </Button>
                </Stack>
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* About */}
      <Section id="about" aria-label="About section">
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Card>
                <SectionTitle icon={<EmojiObjectsOutlined color="primary" />} title="About" />
                <Typography variant="body1" color="text.secondary">
                  Ten plus years across SAP UI5 and Fiori and CAP with Node.js and micro frontends on
                  BTP with a bias to clarity and resilient releases and measurable performance
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={1.2} aria-label="Contact summary">
                  <Row icon={<LocationOn fontSize="small" />} text={PROFILE.location} />
                  <Row
                    icon={<Phone fontSize="small" />}
                    node={
                      <MuiLink href={`tel:${PROFILE.phone.replace(/\s+/g, "")}`}>
                        {PROFILE.phone}
                      </MuiLink>
                    }
                  />
                  <Row
                    icon={<MailOutline fontSize="small" />}
                    node={<MuiLink href={`mailto:${PROFILE.email}`}>{PROFILE.email}</MuiLink>}
                  />
                  <Row
                    icon={<LinkedIn fontSize="small" />}
                    node={
                      <MuiLink href={PROFILE.linkedin} target="_blank" rel="noopener">
                        linkedin.com/in/vktiwari
                      </MuiLink>
                    }
                  />
                </Stack>
              </Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card>
                <SectionTitle icon={<LanguageOutlined color="primary" />} title="Languages" />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label="English" variant="outlined" />
                  <Chip label="Hindi" variant="outlined" />
                </Stack>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Section>

      {/* Skills */}
      <Section id="skills" aria-label="Skills section">
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card>
                <SectionTitle icon={<DevicesOtherOutlined color="primary" />} title="Core stack" />
                <ChipWrap items={SKILLS.core} />
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <SectionTitle
                  icon={<RocketLaunchOutlined color="primary" />}
                  title="Tooling and practices"
                />
                <ChipWrap items={SKILLS.tooling} />
              </Card>
            </Grid>
            <Grid item xs={12}>
              <Card>
                <SectionTitle icon={<StarBorderRounded color="primary" />} title="Soft skills" />
                <ChipWrap items={SKILLS.soft} filled />
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Section>

      {/* Experience */}
      <Section id="experience" aria-label="Experience section">
        <Container maxWidth="lg">
          <Stack spacing={2} mb={3}>
            <SectionTitle icon={<WorkHistoryOutlined color="primary" />} title="Experience" h3 />
            <Typography variant="body1" color="text.secondary">
              Client names are anonymized to protect confidentiality while keeping responsibilities
              and impact accurate
            </Typography>
          </Stack>
          <Stack spacing={3}>
            {EXPERIENCE.map((org) => (
              <Card key={org.company}>
                <Stack spacing={0.5} mb={2}>
                  <Typography variant="h5">
                    {org.role} —{" "}
                    <Box component="span" sx={{ color: "primary.main" }}>
                      {org.company}
                    </Box>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {org.period}
                  </Typography>
                </Stack>
                <Stack spacing={3}>
                  {org.items.map((it, idx) => (
                    <Box key={idx}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", sm: "center" }}
                        spacing={1}
                        mb={0.5}
                      >
                        <Typography variant="subtitle1" fontWeight={700}>
                          {it.title}
                        </Typography>
                        {it.client && <Chip size="small" label={it.client} variant="outlined" />}
                      </Stack>
                      {it.time && (
                        <Typography variant="caption" color="text.secondary">
                          {it.time}
                        </Typography>
                      )}
                      <Stack component="ul" sx={{ pl: 2, mt: 1 }} spacing={0.5}>
                        {it.points.map((p, i) => (
                          <Typography component="li" variant="body2" key={i}>
                            {p}
                          </Typography>
                        ))}
                      </Stack>
                      {it.tags?.length ? (
                        <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
                          {it.tags.map((t) => (
                            <Chip key={t} size="small" label={t} />
                          ))}
                        </Stack>
                      ) : null}
                      {idx < org.items.length - 1 && <Divider sx={{ my: 2 }} />}
                    </Box>
                  ))}
                </Stack>
              </Card>
            ))}
          </Stack>
        </Container>
      </Section>

      {/* Projects — reverse chronological */}
      <Section id="projects" aria-label="Projects section">
        <Container maxWidth="lg">
          <Stack spacing={2} mb={3}>
            <SectionTitle icon={<CodeOutlined color="primary" />} title="Projects" h3 />
            <Typography variant="body1" color="text.secondary">
              All projects in reverse chronological order
            </Typography>
          </Stack>
          <Grid container spacing={3}>
            {PROJECTS.map((p) => (
              <Grid item xs={12} md={6} key={`${p.name}-${p.year}`}>
                <Card>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Typography variant="h6">{p.name}</Typography>
                    <Chip label={`${p.year}`} size="small" />
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center" mt={1}>
                    <Chip label={p.badge} color="primary" variant="outlined" size="small" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {p.desc}
                  </Typography>
                  <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
                    {p.tags.map((t) => (
                      <Chip key={t} size="small" label={t} />
                    ))}
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Section>

      {/* Certifications and Education */}
      <Section id="certs" aria-label="Certifications section">
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Card>
                <SectionTitle
                  icon={<WorkspacePremiumOutlined color="primary" />}
                  title="Certifications and training"
                />
                <Stack spacing={1} component="ul" sx={{ pl: 2 }}>
                  {CERTS.map((c) => (
                    <Typography component="li" variant="body2" key={c}>
                      {c}
                    </Typography>
                  ))}
                </Stack>
              </Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card>
                <SectionTitle icon={<SchoolOutlined color="primary" />} title="Education" />
                <Typography variant="subtitle1" fontWeight={700}>
                  {EDUCATION.degree}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {EDUCATION.institute} · {EDUCATION.year} · {EDUCATION.score}
                </Typography>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Section>

      {/* Awards */}
      <Section id="awards" aria-label="Awards section">
        <Container maxWidth="lg">
          <Card>
            <SectionTitle
              icon={<EmojiEventsOutlined color="primary" />}
              title="Awards and recognition"
            />
            <Stack spacing={1} component="ul" sx={{ pl: 2 }}>
              {AWARDS.map((a) => (
                <Typography component="li" variant="body2" key={a}>
                  {a}
                </Typography>
              ))}
            </Stack>
          </Card>
        </Container>
      </Section>

      {/* Contact (redesigned) */}
      <Section id="contact" aria-label="Contact section">
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Card>
                <Typography variant="h5" mb={1}>
                  Let’s build something great
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={3}>
                  No tracking cookies and messages only used to respond to your inquiry
                </Typography>
                <ContactForm emailTo={PROFILE.email} />
              </Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card>
                <Typography variant="h6" mb={2}>
                  Contact
                </Typography>
                <Stack spacing={1}>
                  <Row
                    icon={<Phone fontSize="small" />}
                    node={
                      <MuiLink href={`tel:${PROFILE.phone.replace(/\s+/g, "")}`}>
                        {PROFILE.phone}
                      </MuiLink>
                    }
                  />
                  <Row
                    icon={<MailOutline fontSize="small" />}
                    node={<MuiLink href={`mailto:${PROFILE.email}`}>{PROFILE.email}</MuiLink>}
                  />
                  <Row
                    icon={<LinkedIn fontSize="small" />}
                    node={
                      <MuiLink href={PROFILE.linkedin} target="_blank" rel="noopener">
                        linkedin.com/in/vktiwari
                      </MuiLink>
                    }
                  />
                  <Row icon={<LocationOn fontSize="small" />} text={PROFILE.location} />
                </Stack>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Section>

      {/* Footer */}
      <Box component="footer" sx={{ py: 6, borderTop: (t) => `1px solid ${t.palette.divider}` }}>
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems="center"
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar alt="Logo" src={logo} sx={{ width: 22, height: 22 }} />
              <Typography variant="body2">
                © {new Date().getFullYear()} {PROFILE.name}. All rights reserved
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ fontStyle: "italic", opacity: 0.8 }}>
              Developed by {PROFILE.name}
            </Typography>
            <Stack direction="row" spacing={2}>
              <MuiLink href="#projects" color="inherit">
                Projects
              </MuiLink>
              <MuiLink href="#experience" color="inherit">
                Experience
              </MuiLink>
              <MuiLink href="#contact" color="inherit">
                Contact
              </MuiLink>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <BackToNav />
    </ThemeProvider>
  );
}

// ---------- Subcomponents ----------
function NavLink({ label, onClick, active }) {
  const theme = useTheme();
  return (
    <Button
      color="inherit"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      sx={{
        fontWeight: 700,
        position: "relative",
        "&:after": {
          content: '""',
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 6,
          height: 2,
          borderRadius: 2,
          background: active ? theme.palette.primary.main : "transparent",
          transition: "background .2s ease",
        },
      }}
    >
      {label}
    </Button>
  );
}

function SectionTitle({ icon, title, h3 = false }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" mb={2}>
      {icon}
      {h3 ? <Typography variant="h3">{title}</Typography> : <Typography variant="h6">{title}</Typography>}
    </Stack>
  );
}

function Row({ icon, text, node }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {icon}
      {node ? (
        node
      ) : (
        <Typography variant="body2" component="span">
          {text}
        </Typography>
      )}
    </Stack>
  );
}

function ChipWrap({ items, filled = false }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" aria-label="Chips list">
      {items.map((s) => (
        <Chip key={s} label={s} variant={filled ? "filled" : "outlined"} />
      ))}
    </Stack>
  );
}

function HeroPhoto() {
  const reduce = useReducedMotion();
  const hoverLift = makeMotion(reduce).hoverLift;
  return (
    <Box
      component={motion.div}
      {...hoverLift}
      sx={{ display: "grid", placeItems: "center" }}
      aria-label="Profile photo"
    >
      <Box
        sx={{
          width: { xs: 220, sm: 260, md: 320 },
          height: { xs: 220, sm: 260, md: 320 },
          borderRadius: "50%",
          overflow: "hidden",
          border: (t) => `6px solid ${t.palette.mode === "dark" ? "#1f2a44" : "#e6eefc"}`,
          boxShadow: "0 20px 60px rgba(37,99,235,.25)",
          background: `url(${photo}) center/cover no-repeat`,
        }}
      />
    </Box>
  );
}

function ContactForm({ emailTo }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    message: "",
    company: "",
    role: "",
  });
  const [sending, setSending] = useState(false);
  const [touched, setTouched] = useState({});
  const emailValid = /.+@.+\..+/.test(form.email);
  const valid = form.name.trim() && emailValid && form.message.trim();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mark = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const onSubmit = (e) => {
    e.preventDefault();
    if (!valid) return;
    setSending(true);
    const subject = encodeURIComponent(`Portfolio contact — ${form.name}`);
    const body = encodeURIComponent(
      `Name: ${form.name}
Email: ${form.email}
Company: ${form.company}
Role: ${form.role}

${form.message}`
    );
    window.location.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
    setTimeout(() => setSending(false), 800);
  };

  return (
    <Box component="form" onSubmit={onSubmit} noValidate aria-label="Contact form">
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Name"
            value={form.name}
            onChange={set("name")}
            onBlur={mark("name")}
            required
            error={touched.name && !form.name.trim()}
            helperText={touched.name && !form.name.trim() ? "Name is required" : " "}
            autoComplete="name"
            inputProps={{ "aria-required": true }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={form.email}
            onChange={set("email")}
            onBlur={mark("email")}
            required
            error={touched.email && !emailValid}
            helperText={touched.email && !emailValid ? "Enter a valid email" : " "}
            autoComplete="email"
            inputProps={{ "aria-required": true }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Company"
            value={form.company}
            onChange={set("company")}
            autoComplete="organization"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Role" value={form.role} onChange={set("role")} />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Project brief"
            value={form.message}
            onChange={set("message")}
            onBlur={mark("message")}
            required
            multiline
            minRows={4}
            error={touched.message && !form.message.trim()}
            helperText={touched.message && !form.message.trim() ? "Please describe your need" : " "}
            inputProps={{ "aria-required": true }}
          />
        </Grid>
        <Grid item xs={12}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button type="submit" variant="contained" disabled={!valid || sending}>
              {sending ? "Preparing" : "Send message"}
            </Button>
            <Button variant="outlined" color="inherit" href={`mailto:${emailTo}`}>
              Email directly
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

function BackToNav() {
  const [showUp, setShowUp] = useState(false);
  const [showDown, setShowDown] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const h = document.documentElement.scrollHeight;
      const wh = window.innerHeight;
      setShowUp(y > 160);
      setShowDown(y + wh < h - 160);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        zIndex: 1200,
      }}
      aria-label="Quick navigation"
    >
      {showUp && (
        <IconButton
          component={motion.button}
          whileHover={reduce ? undefined : { scale: 1.1 }}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          color="primary"
          size="large"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          sx={{
            bgcolor: "background.paper",
            border: (t) => `1px solid ${t.palette.divider}`,
          }}
          aria-label="Back to top"
        >
          <ArrowUpward />
        </IconButton>
      )}
      {showDown && (
        <IconButton
          component={motion.button}
          whileHover={reduce ? undefined : { scale: 1.1 }}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          color="primary"
          size="large"
          onClick={() =>
            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
          }
          sx={{
            bgcolor: "background.paper",
            border: (t) => `1px solid ${t.palette.divider}`,
          }}
          aria-label="Scroll to bottom"
        >
          <ArrowDownward />
        </IconButton>
      )}
    </Box>
  );
}

