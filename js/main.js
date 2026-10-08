// 1. Mobile menu: show or hide the links when the Menu button is pressed
const toggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".main-nav");

toggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", isOpen);
});

// 2. Forms: check the details, then send them to our API, which emails the insurance team.
// When you deploy the backend, change API_URL to its live address (no slash at the end).
const API_URL = "http://localhost:3000";

// Collects every field in a form. Checkboxes with the same name (add-ons) become a list.
function formToObject(form) {
  const result = {};
  for (const [key, value] of new FormData(form).entries()) {
    result[key] = key in result ? [].concat(result[key], value) : value;
  }
  return result;
}

document.querySelectorAll("form[data-form-type]").forEach((form) => {
  const message = form.querySelector(".form-message");
  const button = form.querySelector('button[type="submit"]');
  const show = (text, kind) => {
    message.className = "form-message " + kind;
    message.textContent = text; // textContent keeps the message safe from HTML injection
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // stop the page from reloading
    const data = formToObject(form);

    const missing = [...form.querySelectorAll("[required]")].some((field) =>
      field.type === "checkbox" ? !field.checked : !field.value.trim()
    );
    if (missing) return show("Please fill in the required fields and tick the box to agree.", "error");

    if (!/^(\+?254|0)\d{9}$/.test((data.phone || "").replace(/\s/g, ""))) {
      return show("Enter a valid phone number, for example 0712 345 678.", "error");
    }
    if (form.elements.start && form.elements.end && form.elements.end.value < form.elements.start.value) {
      return show("The return date cannot be before the departure date.", "error");
    }

    const website = data.website || ""; // hidden spam trap, real visitors leave it empty
    delete data.website;
    delete data.consent;

    button.disabled = true;
    show("Sending...", "");
    try {
      const response = await fetch(API_URL + "/api/quote/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formType: form.dataset.formType, consent: true, website, fields: data }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "Something went wrong. Please try again.");
      show("Thank you. We will contact you shortly. Your reference is " + result.reference + ".", "ok");
      form.reset();
    } catch (error) {
      const offline = error instanceof TypeError; // the browser could not reach the API at all
      show(offline ? "We could not reach the server. Please try again, or call us on 0794 794 410." : error.message, "error");
    } finally {
      button.disabled = false;
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
