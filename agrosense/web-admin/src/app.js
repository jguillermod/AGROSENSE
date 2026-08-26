require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");

const app = express();
app.set("view engine", "ejs");
app.set("views", __dirname + "/../views");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/../public"));
app.use(cookieParser());

const AUTH_URL = process.env.AUTH_SERVICE_URL;
const FINCAS_URL = process.env.FINCAS_SERVICE_URL;

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data } = await axios.post(`${AUTH_URL}/api/auth/login`, { email, password });
    res.cookie("token", data.token, { httpOnly: true });
    res.redirect("/dashboard");
  } catch (err) {
    res.render("login", { error: "Credenciales inválidas" });
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const { data: fincas } = await axios.get(`${FINCAS_URL}/api/fincas`);
    res.render("dashboard", { fincas });
  } catch (err) {
    console.error(err.message);
    res.render("dashboard", { fincas: [] });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`web-admin escuchando en puerto ${PORT}`);
});
