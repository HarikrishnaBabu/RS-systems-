// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDg1KAwZXYIeVmkTA7MB3uxYg9PO7FbZAY",
  authDomain: "child-location-tracker-fdb2f.firebaseapp.com",
  projectId: "child-location-tracker-fdb2f",
  storageBucket: "child-location-tracker-fdb2f.firebasestorage.app",
  messagingSenderId: "331325231349",
  appId: "1:331325231349:web:60b113a8ec0cc6a89c35bc",
  measurementId: "G-6WH1ZNFHFN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);