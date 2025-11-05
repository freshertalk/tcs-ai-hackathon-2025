// src/data/projects.js
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

export { PROJECTS };
export default PROJECTS;
