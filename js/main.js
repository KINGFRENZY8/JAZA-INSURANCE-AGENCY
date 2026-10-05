// 1. Mobile menu: show or hide the links when the Menu button is pressed
const toggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".main-nav");

toggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", isOpen);
});

// 2. Quote form: check the fields before "sending".
// Nothing is saved yet. The backend will receive this data later.
const form = document.querySelector("#quote-form");
const message = document.querySelector("#form-message");

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault(); // stop the page from reloading

    const name = form.elements.name.value.trim();
    const phone = form.elements.phone.value.trim();
    const type = form.elements.type.value;

    // Accepts numbers like 0712345678 or +254712345678
    const phoneOk = /^(\+?254|0)\d{9}$/.test(phone.replace(/\s/g, ""));

    message.className = "form-message";

    if (name === "" || type === "") {
      message.textContent = "Enter your name and choose an insurance type.";
      message.classList.add("error");
    } else if (!phoneOk) {
      message.textContent = "Enter a valid phone number, for example 0712 345 678.";
      message.classList.add("error");
    } else {
      console.log("Quote request:", { name, phone, type });
      message.textContent = "Thank you. We will call you shortly.";
      message.classList.add("ok");
      form.reset();
    }
  });
}

// 3. Travel quote form: check the trip details before "sending".
// The data is only logged for now. The backend will receive it later.
const travelForm = document.querySelector("#travel-form");
const travelMessage = document.querySelector("#travel-message");

if (travelForm) {
  travelForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = travelForm.elements;
    const phoneOk = /^(\+?254|0)\d{9}$/.test(f.phone.value.replace(/\s/g, ""));
    const datesOk = f.start.value && f.end.value && f.end.value >= f.start.value;
    const addons = [...travelForm.querySelectorAll('input[name="addon"]:checked')].map((a) => a.value);

    travelMessage.className = "form-message";

    if (!f.name.value.trim() || !f.destination.value.trim() || f.age.value === "") {
      travelMessage.textContent = "Fill in your name, destination and age.";
      travelMessage.classList.add("error");
    } else if (!datesOk) {
      travelMessage.textContent = "Choose a departure date, and a return date that is not before it.";
      travelMessage.classList.add("error");
    } else if (!phoneOk) {
      travelMessage.textContent = "Enter a valid phone number, for example 0712 345 678.";
      travelMessage.classList.add("error");
    } else {
      console.log("Travel quote request:", {
        direction: travelForm.querySelector('input[name="direction"]:checked').value,
        destination: f.destination.value.trim(),
        start: f.start.value, end: f.end.value,
        age: f.age.value, travellers: f.count.value,
        addons, name: f.name.value.trim(), phone: f.phone.value.trim(),
      });
      travelMessage.textContent = "Thank you. We will call you with your travel quote.";
      travelMessage.classList.add("ok");
      travelForm.reset();
    }
  });
}