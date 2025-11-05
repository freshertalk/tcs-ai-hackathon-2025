// src/TCSinterviewAssistantAI.jsx
// React 18 + MUI 5 + Framer Motion — Resume-style single page for Vinay Kumar Tiwari
// Design: Clean, accessible, mobile-first. Forced LIGHT mode.
// Hero: H1 (image centered on its own row) + T1 (centered text).
// Changes: no dark toggle, About text justified, softer hero sizes, hero image centered.

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
  Tooltip,
  GlobalStyles,
  useTheme,
} from "@mui/material";
import {
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
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { motion, useReducedMotion } from "framer-motion";

import logo from "../assets/logo.avif";
import photo from "../assets/v.avif";

// Theme + global styles
import buildTheme, { globalStyles } from "../theme";

// Data modules
import PROFILE_DEFAULT, { PROFILE, SKILLS, EDUCATION } from "../data/profile";
import EXPERIENCE from "../data/experience";
import PROJECTS from "../data/projects";
import CERTS from "../data/certs";
import AWARDS from "../data/awards";

// -------------------------------------------------------
// Utilities
// -------------------------------------------------------
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

const Section = React.forwardRef(function Section(
  { id, children, ...rest },
  ref
) {
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

// Scroll spy for active nav
const useScrollSpy = (ids) => {
  const [active, setActive] = useState(ids[0]);
  const observer = useRef(null);
  useEffect(() => {
    const options = {
      root: null,
      rootMargin: "0px 0px -65% 0px",
      threshold: 0.1,
    };
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

// Scroll progress
const useScrollProgress = () => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop;
      const height = h.scrollHeight - h.clientHeight;
      setProgress(
        height ? Math.min(100, Math.max(0, (scrolled / height) * 100)) : 0
      );
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return progress;
};

// Smooth scroll helper (respects reduced motion)
const useScrollHelper = () => {
  const reduce = useReducedMotion();
  return (id) =>
    document.getElementById(id)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
};

// -------------------------------------------------------
// Main
// -------------------------------------------------------
export default function TCSinterviewAssistantAI() {
  useInterFont();

  // FORCE LIGHT THEME
  const theme = useMemo(() => buildTheme("light"), []);

  const navIds = [
    "about",
    "skills",
    "experience",
    "projects",
    "certs",
    "awards",
    "contact",
  ];
  const activeId = useScrollSpy(navIds);
  const progress = useScrollProgress();
  const scrollTo = useScrollHelper();

  const reduce = useReducedMotion();
  const { fade, fadeUp } = makeMotion(reduce);

  const profile = PROFILE || PROFILE_DEFAULT; // fallback safety

  return (
    <>
      <CssBaseline />
      <GlobalStyles styles={globalStyles} />
      <ThemeWrapper theme={theme}>
        {/* Header */}
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
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ flexGrow: 1 }}
            >
              <Avatar alt="Logo" src={logo} sx={{ width: 28, height: 28 }} />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Vinay{" "}
                <Box component="span" sx={{ color: "primary.main" }}>
                  Tiwari
                </Box>
              </Typography>
              <Chip
                size="small"
                label={profile.ribbon || "AI Enthusiastic"}
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
                <NavLink
                  key={id}
                  label={label}
                  active={activeId === id}
                  onClick={() => scrollTo(id)}
                />
              ))}
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="LinkedIn">
                <IconButton
                  component={MuiLink}
                  href={profile.linkedin}
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
                  href={`mailto:${profile.email}`}
                  aria-label="Send email"
                >
                  <MailOutline />
                </IconButton>
              </Tooltip>
              {/* Theme toggle removed; forced light mode */}
            </Stack>
          </Toolbar>
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-label="Scroll progress"
            sx={{
              height: 3,
              "& .MuiLinearProgress-bar": {
                transition: reduce ? "none" : "transform .2s ease",
              },
            }}
          />
        </AppBar>

        {/* Hero (H1/T1): Image centered row, text centered below */}
        <Box
          component={motion.section}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          sx={{
            py: { xs: 8, md: 12 },
            background: (t) =>
              `linear-gradient(180deg, rgba(37,99,235,.06), transparent 40%), radial-gradient(1000px 500px at 100% -10%, rgba(37,99,235,.14), transparent 60%), ${t.palette.background.default}`,
          }}
        >
          <Container maxWidth="lg">
            <Grid
              container
              spacing={6}
              alignItems="center"
              justifyContent="center"
            >
              <Grid
                item
                xs={12}
                sx={{ display: "flex", justifyContent: "center" }}
              >
                <HeroPhoto />
              </Grid>

              <Grid
                item
                xs={12}
                md={8}
                sx={{ textAlign: "center", mx: "auto" }}
              >
                <Stack spacing={2}>
                  <Typography
                    variant="overline"
                    color="primary"
                    sx={{
                      letterSpacing: ".14em",
                      fontWeight: 700,
                      fontSize: ".75rem",
                    }}
                  >
                    {profile.currentRole}
                  </Typography>
                  <Typography
                    component="h1"
                    variant="h4"
                    sx={{ fontWeight: 700 }}
                  >
                    {profile.title}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    {profile.summary}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    justifyContent="center"
                  >
                    <Chip
                      label="SAP Certified (FIORDEV_21, C_CPE_12)"
                      color="primary"
                      variant="outlined"
                      icon={<VerifiedOutlined />}
                    />
                    <Chip
                      label="Microservices and APIs"
                      variant="outlined"
                      icon={<HubOutlined />}
                    />
                    <Chip
                      label="Security by default"
                      variant="outlined"
                      icon={<SecurityOutlined />}
                    />
                    <Chip
                      label="Observability"
                      variant="outlined"
                      icon={<TimelineOutlined />}
                    />
                  </Stack>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    pt={1}
                    justifyContent="center"
                  >
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
                <Card sx={{ height: "100%" }}>
                  <SectionTitle
                    icon={<EmojiObjectsOutlined color="primary" />}
                    title="About Me"
                  />
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ textAlign: "justify" }}
                  >
                    I have 10+ years of experience architecting and delivering
                    enterprise-grade software solutions across SAP UI5, Fiori,
                    CAPM and SAP BTP — using Node.js on the server side. I
                    specialize in building secure, modular, n-tier business
                    applications with clean domain boundaries and scalable
                    design patterns. My work spans for the clients across the
                    globe and industries including Hi-Tech, MedTech, Pharma,
                    Travel &amp; Transportation (TTH), Aerospace, and IoT —
                    helping customers drive digital modernization and value
                    realization on SAP’s cloud stack. I’m hands-on across the
                    full lifecycle: solution architecture, front-end/UI
                    patterns, backend services, OData APIs, CAPM domain
                    modeling, extensibility, and BTP deployments — with a
                    constant bias toward simplicity, clarity, performance, and
                    maintainability.
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Stack spacing={1.2} aria-label="Contact summary">
                    <Row
                      icon={<LocationOn fontSize="small" />}
                      text={profile.location}
                    />
                    <Row
                      icon={<Phone fontSize="small" />}
                      node={
                        <MuiLink
                          href={`tel:${profile.phone.replace(/\s+/g, "")}`}
                        >
                          {profile.phone}
                        </MuiLink>
                      }
                    />
                    <Row
                      icon={<MailOutline fontSize="small" />}
                      node={
                        <MuiLink href={`mailto:${profile.email}`}>
                          {profile.email}
                        </MuiLink>
                      }
                    />
                    <Row
                      icon={<LinkedIn fontSize="small" />}
                      node={
                        <MuiLink
                          href={profile.linkedin}
                          target="_blank"
                          rel="noopener"
                        >
                          linkedin.com/in/vktiwari
                        </MuiLink>
                      }
                    />
                  </Stack>
                </Card>
              </Grid>
              <Grid item xs={12} md={5}>
                <Card>
                  <SectionTitle
                    icon={<LanguageOutlined color="primary" />}
                    title="Languages"
                  />
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
                  <SectionTitle
                    icon={<DevicesOtherOutlined color="primary" />}
                    title="Core stack"
                  />
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
                  <SectionTitle
                    icon={<StarBorderRounded color="primary" />}
                    title="Soft skills"
                  />
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
              <SectionTitle
                icon={<WorkHistoryOutlined color="primary" />}
                title="Experience"
                h3
              />
              <Typography variant="body1" color="text.secondary">
                Client names are anonymized to protect confidentiality while
                keeping responsibilities and impact accurate.
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
                      <Box key={`${org.company}-${idx}`}>
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
                          {it.client && (
                            <Chip
                              size="small"
                              label={it.client}
                              variant="outlined"
                            />
                          )}
                        </Stack>
                        {it.time && (
                          <Typography variant="caption" color="text.secondary">
                            {it.time}
                          </Typography>
                        )}
                        <Stack
                          component="ul"
                          sx={{ pl: 2, mt: 1 }}
                          spacing={0.5}
                        >
                          {it.points.map((p, i) => (
                            <Typography component="li" variant="body2" key={i}>
                              {p}
                            </Typography>
                          ))}
                        </Stack>
                        {it.tags?.length ? (
                          <Stack
                            direction="row"
                            spacing={1}
                            mt={1}
                            flexWrap="wrap"
                            useFlexGap
                          >
                            {it.tags.map((t) => (
                              <Chip key={t} size="small" label={t} />
                            ))}
                          </Stack>
                        ) : null}
                        {idx < org.items.length - 1 && (
                          <Divider sx={{ my: 2 }} />
                        )}
                      </Box>
                    ))}
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Container>
        </Section>

        {/* Projects */}
        <Section id="projects" aria-label="Projects section">
          <Container maxWidth="lg">
            <Stack spacing={2} mb={3}>
              <SectionTitle
                icon={<CodeOutlined color="primary" />}
                title="Projects"
                h3
              />
              <Typography variant="body1" color="text.secondary">
                All projects in reverse chronological order
              </Typography>
            </Stack>
            <Grid container spacing={3}>
              {PROJECTS.map((p) => (
                <Grid item xs={12} md={6} key={`${p.name}-${p.year}`}>
                  <Card
                    sx={{
                      minHeight: { md: 260 }, // equal height only on desktop
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="h6">{p.name}</Typography>
                      <Chip label={`${p.year}`} size="small" />
                    </Stack>

                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      mt={1}
                    >
                      <Chip
                        label={p.badge}
                        color="primary"
                        variant="outlined"
                        size="small"
                      />
                    </Stack>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {p.desc}
                    </Typography>

                    <Stack
                      direction="row"
                      spacing={1}
                      mt={2}
                      flexWrap="wrap"
                      useFlexGap
                    >
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

        {/* Certifications & Education */}
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
                  <SectionTitle
                    icon={<SchoolOutlined color="primary" />}
                    title="Education"
                  />
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

        {/* Contact */}
        <Section id="contact" aria-label="Contact section">
          <Container maxWidth="lg">
            <Grid container spacing={3}>
              <Grid item xs={12} md={7}>
                <Card>
                  <Typography variant="h5" mb={1}>
                    Let’s build something great
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={3}>
                    No tracking cookies and messages only used to respond to
                    your inquiry.
                  </Typography>
                  <ContactForm emailTo={profile.email} />
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
                        <MuiLink
                          href={`tel:${profile.phone.replace(/\s+/g, "")}`}
                        >
                          {profile.phone}
                        </MuiLink>
                      }
                    />
                    <Row
                      icon={<MailOutline fontSize="small" />}
                      node={
                        <MuiLink href={`mailto:${profile.email}`}>
                          {profile.email}
                        </MuiLink>
                      }
                    />
                    <Row
                      icon={<LinkedIn fontSize="small" />}
                      node={
                        <MuiLink
                          href={profile.linkedin}
                          target="_blank"
                          rel="noopener"
                        >
                          linkedin.com/in/vktiwari
                        </MuiLink>
                      }
                    />
                    <Row
                      icon={<LocationOn fontSize="small" />}
                      text={profile.location}
                    />
                  </Stack>
                </Card>
              </Grid>
            </Grid>
          </Container>
        </Section>

        {/* Footer */}
        <Box
          component="footer"
          sx={{ py: 6, borderTop: (t) => `1px solid ${t.palette.divider}` }}
        >
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
                  © {new Date().getFullYear()} {profile.name}. All rights
                  reserved
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                sx={{ fontStyle: "italic", opacity: 0.8 }}
              >
                Developed by {profile.name}
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
      </ThemeWrapper>
    </>
  );
}

// -------------------------------------------------------
// Subcomponents
// -------------------------------------------------------
function ThemeWrapper({ theme, children }) {
  return (
    <Box component={motion.div}>
      {/* ThemeProvider colocated to avoid circular import in canvas preview */}
      {/* In your app root, wrap with <ThemeProvider theme={theme}>. Here we inline to keep single-file use. */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <ThemeProviderShim theme={theme}>{children}</ThemeProviderShim>
    </Box>
  );
}

function ThemeProviderShim({ theme, children }) {
  const safe = theme || createTheme();
  return <ThemeProvider theme={safe}>{children}</ThemeProvider>;
}

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
      {h3 ? (
        <Typography variant="h3">{title}</Typography>
      ) : (
        <Typography variant="h6">{title}</Typography>
      )}
    </Stack>
  );
}

function Row({ icon, text, node }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {icon}
      {node ? (
        <>{node}</>
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
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      aria-label="Chips list"
    >
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
      sx={{ display: "flex", justifyContent: "center" }}
      aria-label="Profile photo"
    >
      <Box
        sx={{
          width: { xs: 220, sm: 260, md: 320 },
          height: { xs: 220, sm: 260, md: 320 },
          borderRadius: "50%",
          overflow: "hidden",
          border: (t) =>
            `6px solid ${t.palette.mode === "dark" ? "#1f2a44" : "#e6eefc"}`,
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
      `Name: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\nRole: ${form.role}\n\n${form.message}`
    );
    window.location.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
    setTimeout(() => setSending(false), 800);
  };

  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      noValidate
      aria-label="Contact form"
    >
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
            helperText={
              touched.name && !form.name.trim() ? "Name is required" : " "
            }
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
            helperText={
              touched.email && !emailValid ? "Enter a valid email" : " "
            }
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
          <TextField
            fullWidth
            label="Role"
            value={form.role}
            onChange={set("role")}
          />
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
            helperText={
              touched.message && !form.message.trim()
                ? "Please describe your need"
                : " "
            }
            inputProps={{ "aria-required": true }}
          />
        </Grid>
        <Grid item xs={12}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button
              type="submit"
              variant="contained"
              disabled={!valid || sending}
            >
              {sending ? "Preparing" : "Send message"}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              href={`mailto:${emailTo}`}
            >
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
          onClick={() =>
            window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })
          }
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
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: reduce ? "auto" : "smooth",
            })
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
