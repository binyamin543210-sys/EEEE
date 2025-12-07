
// Firebase config – מותאם לדפדפן (compat)
const firebaseConfig = {
  apiKey: "AIzaSyCa808qwjJ8bayhjkTqZ8P9fRhfgi19xtY",
  authDomain: "bnapp-ddcbf.firebaseapp.com",
  databaseURL: "https://bnapp-ddcbf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bnapp-ddcbf",
  storageBucket: "bnapp-ddcbf.firebasestorage.app",
  messagingSenderId: "523128255450",
  appId: "1:523128255450:web:d29cdda3f21435f96686e3",
  measurementId: "G-61DKZ1B5L2"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
