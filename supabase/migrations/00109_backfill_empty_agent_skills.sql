-- Backfill empty skills on bot_profiles based on role name.
-- Only updates agents with empty skills arrays — never overwrites existing skills.

UPDATE bot_profiles SET skills = ARRAY['TypeScript','React','Next.js','Node.js','PostgreSQL']
WHERE skills = '{}' AND lower(trim(role)) = 'full stack engineer';

UPDATE bot_profiles SET skills = ARRAY['React','TypeScript','CSS/Tailwind','Accessibility','Responsive Design']
WHERE skills = '{}' AND lower(trim(role)) IN ('front end engineer', 'frontend developer');

UPDATE bot_profiles SET skills = ARRAY['Node.js','PostgreSQL','API Design (REST)','Caching','Auth']
WHERE skills = '{}' AND lower(trim(role)) IN ('backend engineer', 'backend developer');

UPDATE bot_profiles SET skills = ARRAY['API Design (REST/GraphQL)','PostgreSQL','Caching','Message Queues']
WHERE skills = '{}' AND lower(trim(role)) = 'backend & api engineer';

UPDATE bot_profiles SET skills = ARRAY['Wireframing','Accessibility (WCAG 2.1)','Responsive Design','User Flows']
WHERE skills = '{}' AND lower(trim(role)) IN ('ux designer', 'ui/ux designer');

UPDATE bot_profiles SET skills = ARRAY['E2E Testing','Cross-browser','Accessibility Audit','Performance Budget']
WHERE skills = '{}' AND lower(trim(role)) = 'qa engineer';

UPDATE bot_profiles SET skills = ARRAY['E2E Testing','Cross-browser','Load Testing','Schema Validation']
WHERE skills = '{}' AND lower(trim(role)) = 'qa & test automation lead';

UPDATE bot_profiles SET skills = ARRAY['CI/CD','Docker','Monitoring','Database Migrations','Health Checks']
WHERE skills = '{}' AND lower(trim(role)) = 'devops engineer';

UPDATE bot_profiles SET skills = ARRAY['CI/CD','Docker','Database Migrations','Monitoring']
WHERE skills = '{}' AND lower(trim(role)) = 'database & devops engineer';

UPDATE bot_profiles SET skills = ARRAY['TypeScript','React','Node.js','PostgreSQL']
WHERE skills = '{}' AND lower(trim(role)) = 'developer';

UPDATE bot_profiles SET skills = ARRAY['Prioritisation','User Stories','Acceptance Criteria']
WHERE skills = '{}' AND lower(trim(role)) = 'product owner';

UPDATE bot_profiles SET skills = ARRAY['Requirements Analysis','Success Metrics','Use Case Validation','Data Analysis']
WHERE skills = '{}' AND lower(trim(role)) = 'business analyst';

UPDATE bot_profiles SET skills = ARRAY['Code Quality','Security Review','Performance Analysis','Best Practices']
WHERE skills = '{}' AND lower(trim(role)) = 'code reviewer';

UPDATE bot_profiles SET skills = ARRAY['OWASP Top 10','Auth/AuthZ','XSS/CSRF Prevention','RLS']
WHERE skills = '{}' AND lower(trim(role)) = 'security engineer';

UPDATE bot_profiles SET skills = ARRAY['OWASP Top 10','Performance Profiling','Load Testing','Auth/AuthZ']
WHERE skills = '{}' AND lower(trim(role)) = 'security & performance lead';

UPDATE bot_profiles SET skills = ARRAY['React Native','Mobile APIs','Offline-first','Touch Targets']
WHERE skills = '{}' AND lower(trim(role)) = 'mobile developer';

UPDATE bot_profiles SET skills = ARRAY['React Native','TypeScript','Mobile APIs','Responsive Design']
WHERE skills = '{}' AND lower(trim(role)) = 'mobile & frontend engineer';

UPDATE bot_profiles SET skills = ARRAY['Data Pipelines','PostgreSQL','ETL','Data Modelling']
WHERE skills = '{}' AND lower(trim(role)) = 'data engineer';

UPDATE bot_profiles SET skills = ARRAY['Python','ML Frameworks (PyTorch/TF)','Model Deployment','Data Pipelines']
WHERE skills = '{}' AND lower(trim(role)) = 'senior ml engineer';

UPDATE bot_profiles SET skills = ARRAY['Prioritisation','User Stories','Acceptance Criteria']
WHERE skills = '{}' AND lower(trim(role)) = 'product & compliance lead';
