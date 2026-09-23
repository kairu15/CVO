CVO — Livestock & Poultry Dispersal Tracking System

A full-stack information system built for a City Veterinary Office (CVO) to manage the geo-tagging, dispersal, and re-dispersal of livestock and poultry to beneficiary farmers, replacing manual, paper-based record keeping with a centralized digital workflow.

Overview
Local government veterinary offices run livestock and poultry dispersal programs that provide animals to farmer-beneficiaries across multiple barangays, with a compliance requirement to track offspring and re-dispersal over time. This system digitizes that process end-to-end: registering beneficiaries and animals, recording their location down to the barangay level, tracking the lifecycle of each dispersal, and giving CVO staff a role-appropriate view into program status across the city.

Key Features
- Beneficiary & animal registry — structured records for farmer-beneficiaries and the livestock/poultry dispersed to them
- Geo-tagging — location data down to the barangay level for every beneficiary and dispersal record
- Dispersal & re-dispersal tracking — full lifecycle tracking, including offspring and pass-on compliance
- Role-based dashboards — separate views and permissions for administrators, veterinary/technical staff, and farmer-beneficiaries
- Hierarchical navigation — drill-down from city → barangay → beneficiary
- In-system notifications — alerts for dispersal, vaccination, and re-dispersal milestones
- Mobile companion app — field-friendly access for staff conducting on-site visits

Tech Stack
| Layer      | Technology                         |
|-----------|------------------------------------|
| Backend API | Laravel, MySQL                     |
| Web frontend | React (Vite), Tailwind CSS, React Router |
| Mobile     | Expo (React Native), React Navigation |
| Authentication | Session-based (web) and token-based (mobile) |

Project Structure
```
CVO/
├── backend/     # API, database migrations, business logic
├── frontend/    # Web application (staff & admin dashboards)
├── mobile/      # Field companion app
└── e2e/         # End-to-end test suites
```

User Roles
The system supports distinct roles reflecting how a CVO actually operates:
- **Administrator** — full system access, staff account management, configuration
- **Veterinary/technical staff** — health records, field visits, dispersal and case management
- **Farmer-beneficiary** — self-registration and access to their own dispersal record

Access to every module is enforced consistently across the API and the interface, so a role's permissions can't be bypassed by navigating directly to a page.

Getting Started
> Setup requires a local PHP, Node.js, and MySQL environment. See each subproject's configuration files for the required environment variables — none are committed to this repository.

Install backend dependencies and run database migrations from `backend/`.
Install frontend dependencies and start the dev server from `frontend/`.
(Optional) Install mobile dependencies and run via Expo from `mobile/`.

Copy each subproject's example environment file and fill in local values — database credentials, API URLs, and allowed origins are environment-specific and must not be committed.

Refer to the setup notes inside `backend/`, `frontend/`, and `mobile/` for exact commands.

Testing
- Backend unit/feature tests run against an in-memory test database and do not touch production data.
- End-to-end tests in `e2e/` exercise the full stack, including authentication and role-based access.

Project Context
This system is being developed as a capstone project for a City Veterinary Office in Negros Oriental, Philippines, to support its livestock and poultry dispersal program across the city's barangays.

Status
Actively in development. Core registry, geo-tagging, and dispersal tracking modules are in progress; additional modules (reporting, extended notifications, system settings) are on the roadmap.

License
No license has been specified for this repository. All rights reserved by the project authors unless a license is added.