/**
 * Test environment.
 *
 * env.ts calls process.exit on invalid config, so these have to be set before
 * anything imports it. Imported first by every test that boots the app.
 */
process.env.NODE_ENV = "test";
process.env.FIREBASE_PROJECT_ID = "globalbridge-test";
process.env.FIREBASE_CLIENT_EMAIL = "test@globalbridge-test.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = "test-private-key";
process.env.CORS_ORIGIN = "http://localhost:3000,http://localhost:8081";
process.env.MIN_SUPPORTED_APP_VERSION = "1.2.0";
process.env.LATEST_APP_VERSION = "1.5.0";
process.env.MAINTENANCE_MODE = "";

export {};
