// src/data/profile.js

/* ---------------------------------------------------------------------------
   Years of experience — derived, never hard-coded.
   Career began September 2015 (Wipro, Bengaluru). YEARS rolls over on
   1 January so every figure on the site ages itself.
   --------------------------------------------------------------------------- */
export const CAREER_START_YEAR = 2015;

export const yearsOfExperience = (now = new Date()) =>
  Math.max(1, now.getFullYear() - CAREER_START_YEAR);

export const YEARS = yearsOfExperience();

const PROFILE = {
  name: "Vinay Kumar Tiwari",
  title: `SAP BTP Solution Architect (${YEARS} yrs) — CAPM · Fiori/UI5 · HANA Cloud · GenAI`,
  ribbon: "AI-Assisted Engineering",
  currentRole:
    "Package Consultant — SAP BTP · IBM India Pvt. Ltd. (Jan 2026 — Present)",
  company: "IBM India Pvt. Ltd.",
  designation: "Package Consultant — SAP BTP",
  location: "Noida | Ghazipur, India",
  phone: "+91-7392062233",
  email: "vinay.tiwari.sap@gmail.com",
  linkedin: "https://www.linkedin.com/in/vinay-tiwari-sap",
  website: "https://vinaytiwari.org",
  learningHub: "https://btplearninghub.com",
  instagram: "https://www.instagram.com/_vinaytiwari/",
  authorEmail: "author.vinaytiwari1@gmail.com",
  summary:
    "SAP BTP Solution Architect and SAP Certified Professional designing and delivering enterprise-grade cloud applications across manufacturing, procurement, finance, sales, commercial and healthcare — with AI-assisted engineering woven into how the work actually gets shipped",
  longSummary:
    "Currently leading solution architecture and technical delivery across nine concurrent SAP transformation initiatives for a leading chemical manufacturing client, driving cloud-native application development, stakeholder collaboration, Agile delivery and enterprise modernisation.",
};

const SKILLS = {
  sap: [
    "SAP BTP",
    "SAP CAPM",
    "SAP Fiori / UI5",
    "SAP Build",
    "SAP HANA Cloud",
    "SAP BAS",
    "WorkZone",
    "SAP Event Mesh",
    "Integration Suite",
    "Cloud Foundry",
  ],
  ai: [
    "Generative AI",
    "Agentic AI",
    "SAP AI Core",
    "SAP Joule",
    "Claude Code",
    "GitHub Copilot",
    "Prompt Engineering",
  ],
  engineering: [
    "Node.js",
    "JavaScript",
    "HTML5 / CSS3",
    "REST APIs",
    "OData V2 / V4",
    "Microservices",
    "S/4HANA",
    "PostgreSQL",
    "MongoDB",
    "Java / Spring Boot",
  ],
  architecture: [
    "Cloud-Native Architecture",
    "Clean Architecture",
    "Clean Core",
    "SOLID Principles",
    "Design Patterns",
    "Application Modernisation",
    "Agile (Scrum / XP)",
    "Mentoring & Code Reviews",
  ],
};

// Column config consumed by the Engineering section.
const SKILL_GROUPS = [
  { key: "sap", title: "SAP platform", note: "Where I live" },
  { key: "ai", title: "AI-assisted delivery", note: "How I ship faster" },
  { key: "engineering", title: "Engineering", note: "Under the hood" },
  { key: "architecture", title: "Architecture & practice", note: "How I think" },
];

const EDUCATION = [
  {
    degree: "B.E. — Electronics & Communication Engineering",
    institute: "RGPV, Bhopal",
    year: "2010 — 2014",
    score: "74.90%",
  },
  {
    degree: "PG-DAC — Advanced Computing",
    institute: "C-DAC, Pune",
    year: "Feb — Aug 2015",
    score: "Post Graduate Diploma",
  },
];

const LANGUAGES = [
  { name: "English", level: "Professional" },
  { name: "हिन्दी", level: "Native" },
];

/* The path so far, oldest first. Kept in step with EDUCATION and
   data/experience.js — it is the same story, told as a line. */
const JOURNEY = [
  {
    when: "Early years",
    place: "Ghazipur, Uttar Pradesh",
    what: "Born and raised here; the place his stories, and his Bhojpuri, still come from.",
  },
  {
    when: "2010 — 2014",
    place: "RGPV, Bhopal",
    what: "B.E. in Electronics & Communication Engineering.",
  },
  {
    when: "2015",
    place: "C-DAC, Pune",
    what: "PG-DAC in Advanced Computing — the turn from circuits to software.",
  },
  {
    when: "2015 — 2019",
    place: "Bengaluru",
    what: "Wipro, Mindtree and Cognizant: enterprise Java, microservices, telecom, IoT and cybersecurity.",
  },
  {
    when: "2020 — 2022",
    place: "IBM India",
    what: "SAP UI5 and Fiori — the first years on the SAP platform.",
  },
  {
    when: "2022 — 2026",
    place: "Tata Consultancy Services",
    what: "SAP BTP team lead; Fiori/UI5 delivery for a global MedTech platform.",
  },
  {
    when: "2026 — now",
    place: "IBM India · Noida",
    what: "Solution architecture across nine SAP initiatives, plus BTP Learning Hub and the writing.",
  },
];

export { PROFILE, SKILLS, SKILL_GROUPS, EDUCATION, LANGUAGES, JOURNEY };
export default PROFILE;
