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

// 4. Quote forms on the Motor, Medical and Home pages (all share the "lead-form" class)
document.querySelectorAll(".lead-form").forEach((leadForm) => {
  const msg = leadForm.querySelector(".form-message");

  leadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(leadForm).entries());
    const phoneOk = /^(\+?254|0)\d{9}$/.test((data.phone || "").replace(/\s/g, ""));
    const missing = [...leadForm.querySelectorAll("[required]")].some((f) => !f.value.trim());

    msg.className = "form-message";
    if (missing) {
      msg.textContent = "Please fill in all the required fields.";
      msg.classList.add("error");
    } else if (!phoneOk) {
      msg.textContent = "Enter a valid phone number, for example 0712 345 678.";
      msg.classList.add("error");
    } else {
      console.log("Quote request:", data); // the backend will receive this later
      msg.textContent = "Thank you. We will call you with your quote.";
      msg.classList.add("ok");
      leadForm.reset();
    }
  });
});

// 5. Home page excess slider: the text explains the trade-off (no prices yet)
const excessSlider = document.querySelector("#excess-slider");
const excessText = document.querySelector("#excess-text");
if (excessSlider) {
  const notes = {
    1: "Low excess: you pay less when you claim, and the premium is usually higher.",
    2: "Medium excess: a balance between premium and what you pay when you claim.",
    3: "High excess: you pay more when you claim, and the premium is usually lower.",
  };
  excessSlider.addEventListener("input", () => {
    excessText.textContent = notes[excessSlider.value];
  });
}

// 6. Scrollytelling on the home page: the image changes as each step scrolls into view
const storySteps = document.querySelectorAll(".story-step");
if (storySteps.length && "IntersectionObserver" in window) {
  const storyImgs = document.querySelectorAll(".story-img");
  const storyDots = document.querySelectorAll(".story-dot");

  const showStep = (index) => {
    storySteps.forEach((el, i) => el.classList.toggle("is-active", i === index));
    storyImgs.forEach((el, i) => el.classList.toggle("is-active", i === index));
    storyDots.forEach((el, i) => el.classList.toggle("is-active", i === index));
  };

  // A step becomes active when it crosses a thin band of the screen.
  // Desktop: the middle of the screen. Phones: just below the pinned image.
  let observer;
  const watchSteps = () => {
    if (observer) observer.disconnect();
    const media = document.querySelector(".story-media").getBoundingClientRect();
    const isPhone = window.matchMedia("(max-width: 860px)").matches;
    const vh = window.innerHeight;
    const band = isPhone ? Math.min(media.bottom + 24, vh - 40) : vh * 0.5;
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) showStep(Number(entry.target.dataset.index));
        });
      },
      { rootMargin: `-${Math.round(band)}px 0px -${Math.round(vh - band - 2)}px 0px` }
    );
    storySteps.forEach((step) => observer.observe(step));
  };
  watchSteps();
  window.addEventListener("resize", watchSteps);
}

// 7. About page: reading progress bar, fade-in on scroll, and the chapter story
if (document.querySelector(".about")) {
  document.documentElement.classList.add("js");

  const bar = document.querySelector(".read-progress");
  const updateBar = () => {
    const h = document.documentElement;
    bar.style.transform = `scaleX(${h.scrollTop / (h.scrollHeight - h.clientHeight || 1)})`;
  };
  window.addEventListener("scroll", updateBar, { passive: true });
  updateBar();

  const reveal = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => reveal.observe(el));

  const chapters = [...document.querySelectorAll(".chapter")];
  const num = document.querySelector(".chapter-num");
  const label = document.querySelector(".chapter-label");
  const fill = document.querySelector(".chapter-bar i");
  const chapterWatcher = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      chapters.forEach((c) => c.classList.toggle("is-active", c === e.target));
      num.textContent = e.target.dataset.num;
      label.textContent = e.target.dataset.label;
      fill.style.height = ((chapters.indexOf(e.target) + 1) / chapters.length) * 100 + "%";
    });
  }, { rootMargin: "-45% 0px -45% 0px" });
  chapters.forEach((c) => chapterWatcher.observe(c));
}
