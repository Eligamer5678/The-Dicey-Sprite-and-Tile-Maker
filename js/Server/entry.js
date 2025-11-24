// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyA1K-Y-6UUSLy3Mbs71N3Md0WWvZTX4oss",
    authDomain: "ddlt-5804e.firebaseapp.com",
    databaseURL: "https://ddlt-5804e-default-rtdb.firebaseio.com",
    projectId: "ddlt-5804e",
    storageBucket: "ddlt-5804e.firebasestorage.app",
    messagingSenderId: "961527549137",
    appId: "1:961527549137:web:b9f704ad1468287f5309f0",
    measurementId: "G-G7P47F5QH0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);