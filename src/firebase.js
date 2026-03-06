import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyAP9SUX6q22od59J6o8ukX5VFEY0--l9C8",
  authDomain: "triagem-processo-seletivo.firebaseapp.com",
  projectId: "triagem-processo-seletivo",
  storageBucket: "triagem-processo-seletivo.firebasestorage.app",
  messagingSenderId: "793710620060",
  appId: "1:793710620060:web:9fecd70aa26679f7df2c59"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
