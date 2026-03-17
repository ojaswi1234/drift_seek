# Project Blueprint

## Overview

This project is a Next.js application called "System_Seek". It features a modern user interface, secure authentication using NextAuth.js with GitHub, protected API routes, and a dashboard for authenticated users.

## Implemented Features

*   **Authentication:** Secure sign-in and sign-out functionality using NextAuth.js and the GitHub provider.
*   **Session Management:** The UI conditionally renders different elements based on the user's authentication state.
*   **Protected Routes:** The `/dashboard` page and the `/api/restricted` API route are only accessible to signed-in users.
*   **Global Navigation:** A persistent navigation component is present across all pages.
*   **Styling:** The application is styled with Tailwind CSS and uses custom fonts (`Geist Sans`, `Geist Mono`, `Orbitron`).

## Current Plan: Comprehensive Responsive Design Overhaul

The application's current layout is not optimized for mobile devices. The plan is to refactor the entire application to be mobile-first and fully responsive.

### Implementation Steps

1.  **Responsive Navigation:** Refactor the `Navbar` component to be a fixed top bar on mobile/tablet screens and a fixed left sidebar on desktop screens.
2.  **Adaptive Layout:** Update the root layout to dynamically adjust content padding based on the navigation bar's position, preventing any content from being obscured.
3.  **Component-Level Refinements:**
    *   **Main Page (`app/page.tsx`):** Standardize padding and ensure all sections and typography are fully responsive.
    *   **Dashboard (`app/dashboard/page.tsx`):** Implement responsive typography for better readability on small screens.
    *   **Login Button (`components/login-btn.tsx`):** Adjust button styling to be more compact and suitable for a mobile top-bar layout.
