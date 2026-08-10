/* =============================================================
   FIREBASE CONFIG
   ---------------------------------------------------------------
   You can reuse the SAME Firebase project you already created
   for the family location tracker — just add the new database
   rules below (this system uses a different data path: /entities
   instead of /locations, so it won't conflict).

   Get these values from:
   Firebase Console → Project Settings → General → "Your apps"
   → select your web app → SDK setup and configuration → "Config"
   (make sure you pick the <script>-tag / "Config" option, NOT
   the npm/import snippet).
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

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();
