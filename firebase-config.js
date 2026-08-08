/* =============================================================
   FIREBASE CONFIG
   ---------------------------------------------------------------
   Shared by driver.html, pedestrian.html, and emergency.html.
   Reuses the same Firebase project as the family location tracker.
   ============================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDg1KAwZXYIeVmkTA7MB3uxYg9PO7FbZAY",
  authDomain: "child-location-tracker-fdb2f.firebaseapp.com",
  databaseURL: "https://child-location-tracker-fdb2f-default-rtdb.firebaseio.com",
  projectId: "child-location-tracker-fdb2f",
  storageBucket: "child-location-tracker-fdb2f.firebasestorage.app",
  messagingSenderId: "331325231349",
  appId: "1:331325231349:web:60b113a8ec0cc6a89c35bc",
};

// Initialize Firebase (uses the compat/global SDK loaded via <script> tags)
firebase.initializeApp(firebaseConfig);

// Shared handles used by driver.js, pedestrian.js, emergency.js, and common.js
const auth = firebase.auth();
const db = firebase.database();
