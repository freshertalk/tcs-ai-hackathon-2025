// src/data/projects.js
const PROJECTS = [
  {
    year: 2026,
    name: "Enterprise BTP transformation programme",
    badge: "Chemical manufacturing",
    desc: "Solution architecture across 9 concurrent SAP initiatives — 7 AMS and 2 development projects — on Clean Core principles",
    tags: ["SAP BTP", "CAPM", "Fiori/UI5", "Event Mesh", "Integration Suite"],
  },
  {
    year: 2026,
    name: "BTP Learning Hub",
    badge: "Personal initiative",
    desc: "A MERN-stack platform publishing SAP BTP, CAPM and AI-assisted development learning content",
    tags: ["React", "Node.js", "Express", "MongoDB"],
    href: "https://btplearninghub.com",
  },
  {
    year: 2024,
    name: "Global MedTech transformation platform",
    badge: "Healthcare",
    desc: "Fiori/UI5 applications on BTP supporting critical medical device operations, accelerated with Neptune P9",
    tags: ["SAP UI5", "Fiori", "BTP", "OData", "Neptune P9"],
  },
  {
    year: 2022,
    name: "Solution & innovation experience",
    badge: "SAP SE",
    desc: "Enterprise prototypes and MVPs on BTP supporting pre-sales and customer demonstrations",
    tags: ["SAP BTP", "Node.js", "UI5"],
  },
  {
    year: 2022,
    name: "Cloud HR benefits & claims",
    badge: "HRMS",
    desc: "UI5 applications for cloud HR benefits and claims, integrated with BTP and OData services",
    tags: ["SAP UI5", "BTP", "OData"],
  },
  {
    year: 2021,
    name: "Aerospace returns management",
    badge: "Aerospace",
    desc: "Custom Fiori return-management process built during an S/4HANA transition, through UAT to production",
    tags: ["SAP UI5", "Fiori", "S/4HANA"],
  },
  {
    year: 2020,
    name: "Contractor Resource Management System",
    badge: "Enterprise HR",
    desc: "Lifecycle management for 20,000+ contractor resources with Launchpad and OData integrations",
    tags: ["SAP UI5", "Launchpad", "OData"],
  },
  {
    year: 2019,
    name: "Telecom data management portal",
    badge: "Telecom",
    desc: "Microservices for automated telecom data management and test execution orchestration",
    tags: ["Java 8", "Spring Boot", "Microservices"],
  },
  {
    year: 2018,
    name: "Direct Connect index cache",
    badge: "Performance",
    desc: "Cache management enhancements using Oracle Coherence and ActiveMQ, POC through delivery",
    tags: ["Oracle Coherence", "ActiveMQ"],
  },
  {
    year: 2018,
    name: "Building management — Haystack",
    badge: "IoT",
    desc: "Java REST APIs standardising building data inputs for IoT management platforms",
    tags: ["Java", "REST", "IoT"],
  },
  {
    year: 2017,
    name: "Converged infrastructure automation",
    badge: "Infrastructure",
    desc: "Automation for server, storage and network operations with Spring MVC and Hibernate",
    tags: ["Spring MVC", "Hibernate"],
  },
  {
    year: 2015,
    name: "Enterprise security management",
    badge: "Cybersecurity",
    desc: "Network security and threat management, with HPE Fortify analysis and vulnerability remediation",
    tags: ["HPE Fortify", "Secure SDLC"],
  },
].sort((a, b) => b.year - a.year);

export { PROJECTS };
export default PROJECTS;
