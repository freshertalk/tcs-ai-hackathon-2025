// src/data/experience.js
// Sourced from the current résumé. Client naming follows the résumé:
// named where the résumé names them, descriptive where it does not.

const EXPERIENCE = [
  {
    company: "IBM India Pvt. Ltd.",
    role: "Package Consultant — SAP BTP",
    period: "Jan 2026 — Present · Noida",
    blurb:
      "SAP BTP solution architecture and technical leadership for enterprise digital transformation across manufacturing, procurement, finance, sales, commercial and supply chain.",
    items: [
      {
        title: "Enterprise SAP BTP digital transformation programme",
        client: "Pidilite Industries Limited",
        time: "Jan 2026 — Present · Solution architect · Chemical manufacturing",
        points: [
          "Lead architecture and delivery across 9 concurrent initiatives — 7 AMS and 2 development projects",
          "Architect CAPM and Fiori/UI5 applications on BTP aligned to Clean Core principles",
          "Design secure integrations with REST, OData V2/V4, Event Mesh and Integration Suite",
          "Run architecture reviews, design workshops, estimation, impact analysis and release planning",
          "Mentor teams on Clean Architecture, SOLID, reusable patterns and secure development",
          "Drive AI-assisted delivery with GitHub Copilot, Claude Code, SAP Joule and prompt engineering",
        ],
        tags: [
          "SAP BTP",
          "CAPM",
          "Fiori/UI5",
          "HANA Cloud",
          "Event Mesh",
          "Integration Suite",
        ],
      },
    ],
  },
  {
    company: "Tata Consultancy Services",
    role: "Assistant Consultant / SAP BTP Team Lead",
    period: "Aug 2022 — Jan 2026",
    blurb:
      "SAP BTP and Fiori/UI5 delivery across enterprise healthcare and technology transformation, leading development teams through Agile cycles.",
    items: [
      {
        title: "Global MedTech digital transformation platform",
        client: "Leading US-based medical devices enterprise",
        time: "May 2024 — Jan 2026 · SAPUI5 / Fiori team lead · Healthcare",
        points: [
          "Led Fiori/UI5 development for healthcare modernisation supporting critical MedTech operations",
          "Built responsive UI5 apps to Fiori design guidelines, integrated with OData for real-time data",
          "Used Neptune P9 to accelerate prototyping and low-code delivery",
          "Ran sprint planning, estimation, backlog refinement, code reviews and production deployments",
        ],
        tags: ["SAP UI5", "Fiori", "BTP", "OData", "Neptune P9", "Git"],
      },
      {
        title: "Solution & innovation experience project",
        client: "SAP SE, Bengaluru",
        time: "Sep 2022 — Apr 2024 · BTP / UI5 developer · Hi-tech",
        points: [
          "Built enterprise prototypes supporting pre-sales and customer demonstrations",
          "Developed UI5 and Node.js applications on SAP BTP integrating platform services and OData APIs",
          "Delivered MVPs and proofs-of-concept with cross-functional teams",
        ],
        tags: ["SAP BTP", "Node.js", "SAP UI5", "OData"],
      },
    ],
  },
  {
    company: "IBM India Pvt. Ltd.",
    role: "Application Consultant / SAP UI5 & Fiori Developer",
    period: "Jan 2020 — Aug 2022",
    blurb:
      "UI5 and Fiori application development across healthcare, aerospace and human resource management.",
    items: [
      {
        title: "Cloud HR benefits & claims platform",
        client: "Leading Asia-Pacific healthcare network, Singapore",
        time: "Mar 2022 — Aug 2022 · UI5 / Fiori developer · Healthcare",
        points: [
          "Built UI5 applications for cloud HR benefits and claims management",
          "Designed responsive interfaces integrated with SAP BTP and OData services",
        ],
        tags: ["SAP UI5", "BTP", "OData"],
      },
      {
        title: "Aerospace operations transition platform",
        client: "Leading North American aerospace manufacturer, Canada",
        time: "Sep 2021 — Feb 2022 · UI5 / Fiori developer · Aerospace",
        points: [
          "Developed custom Fiori applications for return management processes during S/4HANA transition",
          "Resolved UAT defects, stabilised production releases and authored technical documentation",
        ],
        tags: ["SAP UI5", "Fiori", "S/4HANA"],
      },
      {
        title: "Contractor Resource Management System (CRMS)",
        client: "IBM internal — Fortune 100 CIO organisation",
        time: "Sep 2020 — Sep 2021 · Application developer · HRMS",
        points: [
          "Built HR applications managing the lifecycle of 20,000+ contractor resources",
          "Delivered UI5 enhancements, Fiori Launchpad configuration and OData integrations",
        ],
        tags: ["SAP UI5", "Launchpad", "OData"],
      },
      {
        title: "Self-service password reset application",
        client: "IBM internal initiative",
        time: "Apr 2020 — Aug 2020 · Solo build",
        points: [
          "Designed and delivered an end-to-end UI5 application for secure SAP password resets",
          "Owned requirements, architecture, development, testing and deployment",
        ],
        tags: ["SAP UI5", "Web IDE"],
      },
    ],
  },
  {
    company: "Cognizant · Mindtree · Wipro",
    role: "Associate / Senior Software Engineer / Project Engineer",
    period: "Sep 2015 — Dec 2019 · Bengaluru",
    blurb:
      "Enterprise Java and microservices development across telecommunications, automotive, cybersecurity, IoT and infrastructure.",
    items: [
      {
        title: "Telecom data management portal",
        client: "Leading Australian telecommunications provider · Cognizant",
        time: "May 2019 — Dec 2019 · Java full-stack developer",
        points: [
          "Built microservices for automated telecom data management and test execution",
          "Designed backend services with Java 8, Spring Boot and REST APIs",
          "Contributed to architecture, estimation, code reviews and production support",
        ],
        tags: ["Java 8", "Spring Boot", "Microservices", "React"],
      },
      {
        title: "Revenue management system",
        client: "Global car rental & mobility provider, UK · Mindtree",
        time: "Feb 2019 — Mar 2019 · Senior developer",
        points: [
          "Implemented security fixes for XSS, SQL injection and log forging",
          "Built reusable Java utilities and refactored components for maintainability",
        ],
        tags: ["Java", "Security", "Refactoring"],
      },
      {
        title: "Direct Connect index cache enhancement",
        client: "Global car rental & mobility provider, UK · Mindtree",
        time: "Jul 2018 — Jan 2019 · Senior developer",
        points: [
          "Designed cache management enhancements with Oracle Coherence and ActiveMQ",
          "Delivered end-to-end from proof-of-concept through performance improvements",
        ],
        tags: ["Oracle Coherence", "ActiveMQ", "Performance"],
      },
      {
        title: "Building management platform — Haystack integration",
        client: "Global semiconductor leader · Wipro",
        time: "Jun 2018 — Jul 2018 · Developer · IoT",
        points: [
          "Developed Java REST APIs for Haystack integration in IoT building management",
          "Implemented backend services for standardised data processing and automation",
        ],
        tags: ["Java", "REST", "IoT"],
      },
      {
        title: "Converged IT infrastructure management & automation",
        client: "Global enterprise IT provider, Houston USA · Wipro",
        time: "Feb 2017 — May 2018 · Developer",
        points: [
          "Built applications automating server, storage and network operations",
          "Designed backend components with Java, Spring MVC, Hibernate and REST",
        ],
        tags: ["Spring MVC", "Hibernate", "Automation"],
      },
      {
        title: "Enterprise security management system",
        client: "Global cybersecurity provider, Austin USA · Wipro",
        time: "Oct 2015 — Feb 2017 · Developer",
        points: [
          "Developed solutions for network security and threat management",
          "Ran security analysis with HPE Fortify and remediated vulnerabilities to enterprise standards",
        ],
        tags: ["HPE Fortify", "Secure SDLC", "Code review"],
      },
    ],
  },
];

const INITIATIVE = {
  name: "BTP Learning Hub",
  role: "Founder & Developer",
  period: "Feb 2026 — Present",
  url: "https://btplearninghub.com",
  points: [
    "A knowledge-sharing platform on SAP BTP, CAPM, Fiori/UI5, AI-assisted development and enterprise architecture",
    "Built end-to-end on the MERN stack — React, Node.js, Express and MongoDB",
    "Publishing blogs, tutorials and training content for the SAP developer community",
  ],
  tags: ["React", "Node.js", "Express", "MongoDB"],
};

export { EXPERIENCE, INITIATIVE };
export default EXPERIENCE;
