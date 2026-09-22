document.addEventListener("DOMContentLoaded", () => {
  const data = window.FOCIT_DATA;
  if (!data) return;

  const coursesContainer = document.getElementById("coursesContainer");
  const filterPills = document.querySelectorAll(".filter-pill");
  const courseSearchInput = document.getElementById("courseSearch");
  const coursesCountLabel = document.getElementById("coursesCountLabel");
  const mobileToggleBtn = document.getElementById("mobileToggleBtn");
  const mobileDrawer = document.getElementById("mobileDrawer");
  const closeDrawerBtn = document.getElementById("closeDrawerBtn");
  const drawerBackdrop = document.getElementById("drawerBackdrop");

  const loginModal = document.getElementById("loginModal");
  const courseModal = document.getElementById("courseModal");
  const activationModal = document.getElementById("activationModal");
  const newsModal = document.getElementById("newsModal");

  const toastContainer = document.getElementById("toastContainer");

  let currentCategory = "all";
  let currentSearch = "";

  function showToast(message, type = "info") {
    if (!toastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let iconSvg = "";
    if (type === "success") {
      iconSvg = `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === "warning") {
      iconSvg = `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else {
      iconSvg = `<svg class="toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `
      ${iconSvg}
      <div class="toast-text">${message}</div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  window.FOCIT_APP_TOAST = showToast;

  function getCategoryVisual(category) {
    switch (category) {
      case "computing":
        return {
          bg: "var(--blue-50)",
          color: "var(--blue-600)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
        };
      case "medicine":
        return {
          bg: "var(--green-50)",
          color: "var(--green-600)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/></svg>`
        };
      case "law":
        return {
          bg: "var(--orange-50)",
          color: "var(--orange-600)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 9l9-6 9 6M5 21h14M6 13h4M14 13h4"/></svg>`
        };
      case "engineering":
        return {
          bg: "var(--purple-50)",
          color: "var(--purple-600)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="20"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="1" y1="9" x2="4" y2="9"/></svg>`
        };
      case "sciences":
        return {
          bg: "var(--blue-50)",
          color: "var(--blue-500)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31L4.75 18.5a2 2 0 0 0 1.7 2.9h11.1a2 2 0 0 0 1.7-2.9L14 9.31V2z"/><line x1="8.5" y1="2" x2="15.5" y2="2"/></svg>`
        };
      case "social":
        return {
          bg: "var(--orange-50)",
          color: "var(--orange-700)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>`
        };
      case "education":
        return {
          bg: "var(--green-50)",
          color: "var(--green-700)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`
        };
      default:
        return {
          bg: "var(--slate-100)",
          color: "var(--slate-700)",
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`
        };
    }
  }

  function renderCourses() {
    if (!coursesContainer) return;

    const filtered = data.courses.filter(course => {
      const matchCategory = currentCategory === "all" || course.category === currentCategory;
      const q = currentSearch.toLowerCase().trim();
      const matchSearch = !q ||
        course.code.toLowerCase().includes(q) ||
        course.title.toLowerCase().includes(q) ||
        course.faculty.toLowerCase().includes(q);

      return matchCategory && matchSearch;
    });

    if (coursesCountLabel) {
      coursesCountLabel.textContent = `Showing ${filtered.length} of ${data.courses.length} courses`;
    }

    if (filtered.length === 0) {
      coursesContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; background: var(--white); border-radius: var(--radius-lg); border: 1px dashed var(--slate-300);">
          <div style="font-size: 1.125rem; font-weight: 700; color: var(--blue-950); margin-bottom: 6px;">No courses found</div>
          <p style="color: var(--slate-500); font-size: 0.875rem;">Try adjusting your search query or faculty filter.</p>
        </div>
      `;
      return;
    }

    coursesContainer.innerHTML = filtered.map(course => {
      const visual = getCategoryVisual(course.category);
      return `
        <article class="course-card" data-faculty="${course.category}" data-id="${course.id}">
          <div>
            <div class="course-card-top">
              <div class="course-icon-badge" style="background-color: ${visual.bg}; color: ${visual.color};">
                ${visual.icon}
              </div>
              <span class="course-code-tag">${course.code}</span>
            </div>
            <h4 class="course-title">${course.title}</h4>
            <p class="course-faculty">${course.faculty}</p>
          </div>

          <div class="course-card-footer">
            <div class="course-chips-group">
              <span class="course-chip">${course.level}</span>
              <span class="course-chip">${course.units} Units</span>
            </div>
            <button class="btn-enroll-action" type="button" data-action="view-course" data-id="${course.id}" aria-label="View syllabus and enroll for ${course.code}">
              <span>Details</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </article>
      `;
    }).join("");

    coursesContainer.querySelectorAll('[data-action="view-course"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openCourseModal(id);
      });
    });
  }

  function openCourseModal(courseId) {
    const course = data.courses.find(c => c.id === courseId);
    if (!course || !courseModal) return;

    const modalBody = courseModal.querySelector(".modal-body");
    const modalTitle = courseModal.querySelector(".modal-title");

    if (modalTitle) {
      modalTitle.innerHTML = `
        <span class="course-code-tag">${course.code}</span>
        <span>${course.title}</span>
      `;
    }

    if (modalBody) {
      modalBody.innerHTML = `
        <div style="margin-bottom: 20px;">
          <div style="font-size: 0.8125rem; font-weight: 700; color: var(--blue-600); text-transform: uppercase; margin-bottom: 4px;">Faculty Offering</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--blue-950);">${course.faculty}</div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
          <div style="background: var(--slate-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--slate-200);">
            <div style="font-size: 0.75rem; color: var(--slate-500); font-weight: 600;">Academic Level</div>
            <div style="font-size: 0.9375rem; font-weight: 800; color: var(--blue-950);">${course.level}</div>
          </div>
          <div style="background: var(--slate-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--slate-200);">
            <div style="font-size: 0.75rem; color: var(--slate-500); font-weight: 600;">Credit Units</div>
            <div style="font-size: 0.9375rem; font-weight: 800; color: var(--blue-950);">${course.units} Units</div>
          </div>
          <div style="background: var(--slate-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--slate-200);">
            <div style="font-size: 0.75rem; color: var(--slate-500); font-weight: 600;">Duration</div>
            <div style="font-size: 0.9375rem; font-weight: 800; color: var(--blue-950);">${course.semesters}</div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="font-size: 0.8125rem; font-weight: 700; color: var(--slate-700); margin-bottom: 6px;">Lead Course Lecturer</div>
          <div style="font-size: 0.9375rem; color: var(--blue-900); font-weight: 600;">${course.instructor}</div>
        </div>

        <div>
          <div style="font-size: 0.8125rem; font-weight: 700; color: var(--slate-700); margin-bottom: 6px;">Syllabus & Course Scope</div>
          <p style="font-size: 0.9375rem; color: var(--slate-600); line-height: 1.6;">${course.description}</p>
        </div>
      `;
    }

    const enrollBtn = courseModal.querySelector("#modalEnrollBtn");
    if (enrollBtn) {
      enrollBtn.onclick = () => {
        courseModal.close();
        showToast(`Successfully enrolled in ${course.code}: ${course.title}`, "success");
      };
    }

    courseModal.showModal();
  }

  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      currentCategory = pill.getAttribute("data-category") || "all";
      renderCourses();
    });
  });

  if (courseSearchInput) {
    courseSearchInput.addEventListener("input", (e) => {
      currentSearch = e.target.value;
      renderCourses();
    });
  }

  function openNewsModal(newsId) {
    const item = data.news.find(n => n.id === newsId);
    if (!item || !newsModal) return;

    const modalTitle = newsModal.querySelector(".modal-title");
    const modalBody = newsModal.querySelector(".modal-body");

    if (modalTitle) {
      modalTitle.textContent = item.title;
    }

    if (modalBody) {
      modalBody.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <div style="display: flex; gap: 8px;">
            ${item.tags.map(t => `<span class="badge badge-${t.type}">${t.label}</span>`).join("")}
          </div>
          <span style="font-size: 0.8125rem; color: var(--slate-400);">${item.date}</span>
        </div>
        <div style="font-size: 1rem; color: var(--slate-700); line-height: 1.7; margin-bottom: 20px;">
          ${item.excerpt}
        </div>
        <div style="background-color: var(--blue-50); border: 1px solid var(--blue-100); border-radius: var(--radius-md); padding: 16px; font-size: 0.875rem; color: var(--blue-900);">
          <strong>Official Directive:</strong> Students and concerned stakeholders are urged to regularly verify updates via their authorized departmental notice boards or contact the ICT registry.
        </div>
      `;
    }

    newsModal.showModal();
  }

  document.querySelectorAll(".news-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-id");
      openNewsModal(id);
    });
  });

  document.querySelectorAll(".portal-service-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-service");
      if (action === "srv-dashboard" || action === "srv-course-reg" || action === "srv-exam-results") {
        if (loginModal) loginModal.showModal();
      } else if (action === "srv-elibrary") {
        showToast("Accessing UNIOSUN Digital Academic Repositories...", "info");
      } else if (action === "srv-calendar") {
        showToast("Downloading 2025/2026 Academic Session Calendar PDF...", "success");
      } else {
        showToast("Opening Registrar Notices & Official Circulars...", "info");
      }
    });
  });

  document.querySelectorAll('[data-action="open-login"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (loginModal) loginModal.showModal();
    });
  });

  document.querySelectorAll('[data-action="open-activation"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (activationModal) activationModal.showModal();
    });
  });

  document.querySelectorAll(".modal-close-btn, [data-action='close-modal']").forEach(btn => {
    btn.addEventListener("click", () => {
      const dialog = btn.closest("dialog");
      if (dialog) dialog.close();
    });
  });

  [loginModal, courseModal, activationModal, newsModal].forEach(dialog => {
    if (!dialog) return;
    dialog.addEventListener("click", (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        dialog.close();
      }
    });
  });

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const matricInput = document.getElementById("loginMatric");
      const passInput = document.getElementById("loginPassword");

      if (!matricInput.value.trim() || !passInput.value.trim()) {
        showToast("Please provide both your identifier and password", "warning");
        return;
      }

      showToast(`Authenticating ${matricInput.value}... Welcome to FOCIT Portal!`, "success");
      if (loginModal) loginModal.close();
      loginForm.reset();
    });
  }

  const activationForm = document.getElementById("activationForm");
  if (activationForm) {
    activationForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const matric = document.getElementById("actMatric");
      if (!matric.value.trim()) {
        showToast("Please enter a valid Matriculation number", "warning");
        return;
      }

      showToast(`Account verification email dispatched for ${matric.value}`, "success");
      if (activationModal) activationModal.close();
      activationForm.reset();
    });
  }

  const tabBtns = document.querySelectorAll(".modal-tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.getAttribute("data-tab");
      const label = document.getElementById("loginIdentifierLabel");
      const input = document.getElementById("loginMatric");
      if (type === "staff") {
        if (label) label.textContent = "Staff ID / Email Address";
        if (input) input.placeholder = "e.g. akanbi.caleb@uniosun.edu.ng";
      } else {
        if (label) label.textContent = "Matriculation Number";
        if (input) input.placeholder = "e.g. 2023/12345";
      }
    });
  });

  if (mobileToggleBtn && mobileDrawer) {
    mobileToggleBtn.addEventListener("click", () => {
      mobileDrawer.classList.add("open");
      mobileToggleBtn.setAttribute("aria-expanded", "true");
    });
  }

  function closeMobileDrawer() {
    if (mobileDrawer) {
      mobileDrawer.classList.remove("open");
      if (mobileToggleBtn) mobileToggleBtn.setAttribute("aria-expanded", "false");
    }
  }

  if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeMobileDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeMobileDrawer);

  renderCourses();
});
