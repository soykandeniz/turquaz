const header = document.querySelector('.site-header');
const revealElements = document.querySelectorAll('.reveal');
const staggerTargets = document.querySelectorAll('[data-stagger]');
const parallaxTargets = document.querySelectorAll('[data-parallax]');
const navLinks = document.querySelectorAll('a[href^="#"]');
const gallery = document.getElementById('galleryGrid');
const cursorGlow = document.getElementById('cursorGlow');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const navLinksMenu = document.getElementById('navLinks');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let rafScheduled = false;

/* ─── Mobile Nav Toggle ─── */
if (hamburgerBtn && navLinksMenu) {
  const closeMobileMenu = () => {
    navLinksMenu.classList.remove('is-open');
    header?.classList.remove('menu-open');
    hamburgerBtn.classList.remove('is-active');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  hamburgerBtn.addEventListener('click', () => {
    const isOpen = navLinksMenu.classList.toggle('is-open');
    header?.classList.toggle('menu-open', isOpen);
    if (header) {
      const navHeight = Math.round(header.getBoundingClientRect().height || 64);
      document.documentElement.style.setProperty('--mobile-nav-top', `${navHeight}px`);
    }
    hamburgerBtn.classList.toggle('is-active', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  navLinksMenu.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      closeMobileMenu();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      closeMobileMenu();
    }
  });
}

const reservationForm = document.querySelector('.reservation-form');
const reservationDatePicker = document.getElementById('reservationDatePicker');
const resDatePickerBtn = document.getElementById('resDatePickerBtn');
const resPrevDayBtn = document.getElementById('resPrevDayBtn');
const resNextDayBtn = document.getElementById('resNextDayBtn');
const reservationCalendarBackdrop = document.getElementById('reservationCalendarBackdrop');
const reservationCalendarGrid = document.getElementById('reservationCalendarGrid');
const reservationCalendarTitle = document.getElementById('reservationCalendarTitle');
const reservationCalendarSelected = document.getElementById('reservationCalendarSelected');
const reservationCalendarLoader = document.getElementById('reservationCalendarLoader');
const calendarPrevMonthBtn = document.getElementById('calendarPrevMonthBtn');
const calendarNextMonthBtn = document.getElementById('calendarNextMonthBtn');
const calendarCloseBtn = document.getElementById('calendarCloseBtn');
const slotGrid = document.getElementById('slotGrid');
const mealTabs = document.getElementById('mealTabs');
const dateField = document.getElementById('dateField');
const timeField = document.getElementById('timeField');
const reservationMessage = document.getElementById('reservationMessage');

const SLOT_CAPACITY = 15;
const OPEN_DAYS = 90;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzfnVWOZ2uzz5JGCcnR_IyV0OFMciQzE5Kyq59JwIGIYV28X4Yepg9rWsQ1vIooJMo9Jw/exec';
const CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MEALS = [
  { id: 'breakfast', label: 'Breakfast', slots: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] },
  { id: 'lunch', label: 'Lunch', slots: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'] },
  { id: 'dinner', label: 'Dinner', slots: ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'] }
];

const state = {
  selectedDate: '',
  selectedTime: '',
  selectedMeal: 'dinner',
  availabilityByDate: {}
};

let reservationMinDate = '';
let reservationMaxDate = '';
let reservationViewDate = null;
let isReservationCalendarLoading = false;

const splitToStagger = (element) => {
  const text = element.textContent;
  element.textContent = '';

  [...text].forEach((char, index) => {
    const span = document.createElement('span');
    span.className = 'stagger-char';
    span.textContent = char === ' ' ? '\u00A0' : char;
    span.style.transitionDelay = `${index * 36}ms`;
    element.appendChild(span);
  });
};

staggerTargets.forEach(splitToStagger);

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add('is-visible');
      const chars = entry.target.querySelectorAll('.stagger-char');
      chars.forEach((char) => char.classList.add('in'));
      revealObserver.unobserve(entry.target);
    });
  },
  {
    threshold: 0.06,
    rootMargin: '0px 0px -2% 0px'
  }
);

revealElements.forEach((element) => revealObserver.observe(element));

const updateParallax = () => {
  if (reducedMotion) {
    return;
  }

  const viewportHeight = window.innerHeight;

  parallaxTargets.forEach((target) => {
    const speed = Number(target.dataset.parallax ?? 0.1);
    const rect = target.getBoundingClientRect();
    const centerOffset = (rect.top + rect.height / 2 - viewportHeight / 2) * speed;

    target.style.transform = `translate3d(0, ${centerOffset}px, 0) scale(1.04)`;
  });
};

const requestParallaxUpdate = () => {
  if (rafScheduled) {
    return;
  }

  rafScheduled = true;
  requestAnimationFrame(() => {
    updateParallax();
    rafScheduled = false;
  });
};

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey) => {
  if (!dateKey) {
    return null;
  }

  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day);
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const prettyDate = (date) => ({
  day: date.toLocaleDateString('en-US', { weekday: 'short' }),
  date: date.toLocaleDateString('en-US', { day: '2-digit' }),
  month: date.toLocaleDateString('en-US', { month: 'short' })
});

const formatDateLabel = (dateKey) => {
  if (!dateKey) {
    return 'Select Day';
  }

  const date = parseDateKey(dateKey);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  });
};

const setMessage = (text, kind = '') => {
  if (!reservationMessage) {
    return;
  }

  reservationMessage.textContent = text;
  reservationMessage.classList.remove('error', 'success');
  if (kind) {
    reservationMessage.classList.add(kind);
  }
};

const showSuccessModal = (payload) => {
  const backdrop = document.getElementById('successModalBackdrop');
  const details = document.getElementById('modalDetails');
  const emailNote = document.getElementById('modalEmailNote');
  const closeBtn = document.getElementById('modalCloseBtn');
  if (!backdrop || !details) return;

  const mealLabel = (payload.meal || '').charAt(0).toUpperCase() + (payload.meal || '').slice(1);
  const dateObj = parseDateKey(payload.date);
  const prettyDateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });

  details.innerHTML = [
    ['Date', prettyDateStr],
    ['Time', payload.time],
    ['Guests', payload.guests],
    ['Meal', mealLabel],
    ['Name', payload.name],
    ['Phone', payload.phone]
  ].map(([label, value]) =>
    `<span class="detail-label">${label}</span><span class="detail-value">${value}</span>`
  ).join('');

  emailNote.textContent = payload.email
    ? `A confirmation email has been sent to ${payload.email}`
    : '';

  backdrop.classList.remove('hidden', 'fade-out');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const closeModal = () => {
    backdrop.classList.add('fade-out');
    setTimeout(() => {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }, 400);
  };

  closeBtn.onclick = closeModal;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
};

const requestAvailability = async (dateKey) => {
  if (!APPS_SCRIPT_URL) {
    throw new Error('Reservation API is not configured');
  }

  const url = `${APPS_SCRIPT_URL}?action=availability&date=${encodeURIComponent(dateKey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Availability service unreachable');
  }

  const data = await response.json();
  return data.slots ?? {};
};

const slotStateByGuests = (guestCount) => {
  if (guestCount >= SLOT_CAPACITY) return 'full';
  if (guestCount >= Math.ceil(SLOT_CAPACITY * 0.7)) return 'limited';
  return 'open';
};

const renderMealTabs = () => {
  if (!mealTabs) {
    return;
  }

  mealTabs.innerHTML = '';
  MEALS.forEach((meal) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meal-chip';
    button.textContent = meal.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(state.selectedMeal === meal.id));

    if (state.selectedMeal === meal.id) {
      button.classList.add('is-active');
    }

    button.addEventListener('click', () => {
      state.selectedMeal = meal.id;
      state.selectedTime = '';
      timeField.value = '';
      renderMealTabs();
      renderSlots();
    });

    mealTabs.appendChild(button);
  });
};

const renderSlots = () => {
  if (!slotGrid || !state.selectedDate) {
    return;
  }

  const availability = state.availabilityByDate[state.selectedDate] ?? {};
  const currentMeal = MEALS.find((meal) => meal.id === state.selectedMeal) ?? MEALS[2];

  slotGrid.innerHTML = '';
  currentMeal.slots.forEach((slot) => {
    const used = Number(availability[slot] ?? 0);
    const status = slotStateByGuests(used);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot-chip';
    button.dataset.state = status;
    button.textContent = slot;
    button.disabled = status === 'full';

    if (slot === state.selectedTime) {
      button.classList.add('is-active');
    }

    button.addEventListener('click', () => {
      state.selectedTime = slot;
      timeField.value = slot;
      renderSlots();
    });

    slotGrid.appendChild(button);
  });
};

const renderReservationCalendar = () => {
  if (!reservationCalendarGrid || !reservationMinDate || !reservationMaxDate) {
    return;
  }

  const selectedDate = parseDateKey(state.selectedDate || reservationMinDate);
  const minDate = parseDateKey(reservationMinDate);
  const maxDate = parseDateKey(reservationMaxDate);
  const visibleMonth = startOfMonth(reservationViewDate || selectedDate || minDate);
  const currentDayKey = toDateKey(new Date());
  const totalDays = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const firstWeekday = visibleMonth.getDay();
  const minMonthKey = toDateKey(startOfMonth(minDate));
  const maxMonthKey = toDateKey(startOfMonth(maxDate));

  reservationViewDate = visibleMonth;

  if (reservationCalendarTitle) {
    reservationCalendarTitle.textContent = visibleMonth.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  }

  if (reservationCalendarSelected) {
    reservationCalendarSelected.textContent = `Selected: ${formatDateLabel(state.selectedDate)}`;
  }

  if (calendarPrevMonthBtn) {
    calendarPrevMonthBtn.disabled = isReservationCalendarLoading || toDateKey(visibleMonth) <= minMonthKey;
  }

  if (calendarNextMonthBtn) {
    calendarNextMonthBtn.disabled = isReservationCalendarLoading || toDateKey(visibleMonth) >= maxMonthKey;
  }

  reservationCalendarGrid.innerHTML = '';

  CALENDAR_WEEKDAYS.forEach((weekday) => {
    const label = document.createElement('span');
    label.className = 'reservation-calendar-weekday';
    label.textContent = weekday;
    reservationCalendarGrid.appendChild(label);
  });

  for (let emptyIndex = 0; emptyIndex < firstWeekday; emptyIndex += 1) {
    const emptyCell = document.createElement('span');
    emptyCell.className = 'reservation-calendar-day is-empty';
    emptyCell.setAttribute('aria-hidden', 'true');
    reservationCalendarGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const button = document.createElement('button');
    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
    const dateKey = toDateKey(date);
    const isOutOfRange = dateKey < reservationMinDate || dateKey > reservationMaxDate;

    button.type = 'button';
    button.className = 'reservation-calendar-day';
    button.textContent = String(day);
    button.disabled = isReservationCalendarLoading || isOutOfRange;
    button.setAttribute('aria-label', formatDateLabel(dateKey));

    if (dateKey === state.selectedDate) {
      button.classList.add('is-selected');
    }

    if (dateKey === currentDayKey) {
      button.classList.add('is-today');
    }

    button.addEventListener('click', async () => {
      if (isReservationCalendarLoading) {
        return;
      }

      setReservationCalendarLoading(true);

      try {
        await setReservationDate(dateKey);
        await closeReservationCalendar();
      } finally {
        setReservationCalendarLoading(false);
      }
    });

    reservationCalendarGrid.appendChild(button);
  }
};

const setReservationCalendarLoading = (isLoading) => {
  isReservationCalendarLoading = isLoading;

  if (reservationCalendarBackdrop) {
    reservationCalendarBackdrop.classList.toggle('is-loading', isLoading);
  }

  if (reservationCalendarLoader) {
    reservationCalendarLoader.setAttribute('aria-hidden', String(!isLoading));
  }

  if (calendarCloseBtn) {
    calendarCloseBtn.disabled = isLoading;
  }

  renderReservationCalendar();
};

const openReservationCalendar = () => {
  if (!reservationCalendarBackdrop) {
    return;
  }

  setReservationCalendarLoading(false);
  reservationViewDate = startOfMonth(parseDateKey(state.selectedDate || reservationMinDate));
  renderReservationCalendar();
  reservationCalendarBackdrop.classList.remove('hidden', 'fade-out');
  reservationCalendarBackdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
};

const closeReservationCalendar = () => {
  if (!reservationCalendarBackdrop || reservationCalendarBackdrop.classList.contains('hidden')) {
    return Promise.resolve();
  }

  reservationCalendarBackdrop.classList.add('fade-out');
  return new Promise((resolve) => {
    setTimeout(() => {
      reservationCalendarBackdrop.classList.add('hidden');
      reservationCalendarBackdrop.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      resolve();
    }, 300);
  });
};

const updateReservationDateUi = () => {
  if (resDatePickerBtn) {
    resDatePickerBtn.textContent = formatDateLabel(state.selectedDate);
  }

  if (reservationDatePicker) {
    reservationDatePicker.value = state.selectedDate;
  }

  if (resPrevDayBtn) {
    resPrevDayBtn.disabled = state.selectedDate <= reservationMinDate;
  }

  if (resNextDayBtn) {
    resNextDayBtn.disabled = state.selectedDate >= reservationMaxDate;
  }

  if (reservationCalendarSelected) {
    reservationCalendarSelected.textContent = `Selected: ${formatDateLabel(state.selectedDate)}`;
  }

  if (reservationCalendarBackdrop && !reservationCalendarBackdrop.classList.contains('hidden')) {
    renderReservationCalendar();
  }
};

const setReservationDate = async (dateKey) => {
  if (!dateKey) {
    return;
  }

  const boundedDate = dateKey < reservationMinDate ? reservationMinDate : (dateKey > reservationMaxDate ? reservationMaxDate : dateKey);

  state.selectedDate = boundedDate;
  reservationViewDate = startOfMonth(parseDateKey(boundedDate));
  state.selectedTime = '';
  dateField.value = boundedDate;
  timeField.value = '';
  setMessage('');
  updateReservationDateUi();
  await hydrateAvailability(boundedDate);
  renderSlots();
};

const shiftReservationDate = async (days) => {
  if (!state.selectedDate) {
    return;
  }

  const date = new Date(`${state.selectedDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  await setReservationDate(toDateKey(date));
};

const hydrateAvailability = async (dateKey) => {
  try {
    const data = await requestAvailability(dateKey);
    state.availabilityByDate[dateKey] = data;
  } catch {
    setMessage('Unable to load live availability right now.', 'error');
    state.availabilityByDate[dateKey] = {};
  }
};

const submitReservation = async (payload) => {
  if (!APPS_SCRIPT_URL) {
    throw new Error('Reservation API is not configured');
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'reserve', payload })
  });

  const data = await response.json();
  return data;
};

const inferMealByTime = (time) => {
  const meal = MEALS.find((item) => item.slots.includes(time));
  return meal ? meal.id : 'dinner';
};

const initializeReservation = async () => {
  if (!reservationForm || !reservationDatePicker || !resDatePickerBtn || !resPrevDayBtn || !resNextDayBtn || !slotGrid || !dateField || !timeField || !mealTabs) {
    return;
  }

  const currentHour = new Date().getHours();
  if (currentHour < 12) state.selectedMeal = 'breakfast';
  else if (currentHour < 17) state.selectedMeal = 'lunch';
  else state.selectedMeal = 'dinner';

  const todayKey = toDateKey(new Date());
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + OPEN_DAYS - 1);
  reservationMinDate = todayKey;
  reservationMaxDate = toDateKey(maxDate);

  reservationDatePicker.min = reservationMinDate;
  reservationDatePicker.max = reservationMaxDate;

  state.selectedDate = todayKey;
  dateField.value = todayKey;

  updateReservationDateUi();
  renderMealTabs();
  await hydrateAvailability(todayKey);
  renderSlots();

  reservationDatePicker.addEventListener('change', async () => {
    await setReservationDate(reservationDatePicker.value);
  });

  resDatePickerBtn.addEventListener('click', () => {
    openReservationCalendar();
  });

  resPrevDayBtn.addEventListener('click', async () => {
    await shiftReservationDate(-1);
  });

  resNextDayBtn.addEventListener('click', async () => {
    await shiftReservationDate(1);
  });

  calendarPrevMonthBtn?.addEventListener('click', () => {
    reservationViewDate = addMonths(reservationViewDate || parseDateKey(state.selectedDate || reservationMinDate), -1);
    renderReservationCalendar();
  });

  calendarNextMonthBtn?.addEventListener('click', () => {
    reservationViewDate = addMonths(reservationViewDate || parseDateKey(state.selectedDate || reservationMinDate), 1);
    renderReservationCalendar();
  });

  calendarCloseBtn?.addEventListener('click', closeReservationCalendar);
  reservationCalendarBackdrop?.addEventListener('click', (event) => {
    if (event.target === reservationCalendarBackdrop) {
      closeReservationCalendar();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeReservationCalendar();
    }
  });

  reservationForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(reservationForm);
    const guests = Number(formData.get('guests') || 0);
    const phone = String(formData.get('phone') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();

    if (!state.selectedDate || !state.selectedTime) {
      setMessage('Please select both a date and a timeslot.', 'error');
      return;
    }
    if (!formData.get('name') || String(formData.get('name')).trim() === '') {
        setMessage('Please enter your name.', 'error');
        return;
    }

    if (guests < 1 || guests > SLOT_CAPACITY) {
      setMessage(`Guests must be between 1 and ${SLOT_CAPACITY}.`, 'error');
      return;
    }

    if (!phone || phone.length < 7) {
      setMessage('Please enter a valid phone number.', 'error');
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Please enter a valid email address.', 'error');
      return;
    }

    const dateAvailability = state.availabilityByDate[state.selectedDate] ?? {};
    const occupied = Number(dateAvailability[state.selectedTime] ?? 0);
    if (occupied + guests > SLOT_CAPACITY) {
      setMessage('Selected timeslot cannot fit this guest count. Choose another slot.', 'error');
      await hydrateAvailability(state.selectedDate);
      renderSlots();
      return;
    }

    const payload = {
      name: String(formData.get('name') ?? '').trim(),
      phone,
      email,
      guests,
      note: String(formData.get('note') ?? '').trim(),
      date: state.selectedDate,
      time: state.selectedTime,
      meal: inferMealByTime(state.selectedTime),
      createdAt: new Date().toISOString()
    };

    const reserveBtn = document.getElementById('reserveBtn');
    reserveBtn?.classList.add('is-loading');
    reserveBtn && (reserveBtn.disabled = true);

    try {
      const result = await submitReservation(payload);
      if (!result.ok) {
        throw new Error('Reservation failed');
      }

      setMessage('', '');
      showSuccessModal(payload);
      reservationForm.reset();
      dateField.value = state.selectedDate;
      timeField.value = state.selectedTime;
      await hydrateAvailability(state.selectedDate);
      renderSlots();
    } catch {
      setMessage('Reservation could not be saved right now. Please try again.', 'error');
    } finally {
      reserveBtn?.classList.remove('is-loading');
      reserveBtn && (reserveBtn.disabled = false);
    }
  });
};

window.addEventListener('scroll', () => {
  const isScrolled = window.scrollY > 24;
  header.classList.toggle('scrolled', isScrolled);

  requestParallaxUpdate();
}, { passive: true });

window.addEventListener('resize', requestParallaxUpdate);
window.addEventListener('load', requestParallaxUpdate);
window.addEventListener('load', initializeReservation);

const scrollToSection = (destination) => {
  const headerHeight = header ? header.getBoundingClientRect().height : 0;
  const top = destination.getBoundingClientRect().top + window.scrollY - headerHeight + 2;
  window.scrollTo({ top, behavior: 'smooth' });
};

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const targetSelector = link.getAttribute('href');
    if (!targetSelector || targetSelector === '#') {
      return;
    }

    event.preventDefault();

    if (targetSelector === '#top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const destination = document.querySelector(targetSelector);
    if (!destination) {
      return;
    }

    scrollToSection(destination);

    // Re-scroll after lazy images above may have loaded and shifted layout
    setTimeout(() => scrollToSection(destination), 400);
  });
});

if (gallery && cursorGlow && window.matchMedia('(pointer:fine)').matches) {
  gallery.addEventListener('mouseenter', () => cursorGlow.classList.add('active'));
  gallery.addEventListener('mouseleave', () => cursorGlow.classList.remove('active'));
  gallery.addEventListener('mousemove', (event) => {
    cursorGlow.style.left = `${event.clientX}px`;
    cursorGlow.style.top = `${event.clientY}px`;
  });
}

window.setTimeout(() => {
  document.querySelectorAll('.mask-reveal:not(.is-visible)').forEach((item) => {
    item.classList.add('is-visible');
  });
}, 1800);

/* ─── Catering Popup ─── */

const openContactModal = (presetSubject) => {
  const backdrop = document.getElementById('contactModalBackdrop');
  if (!backdrop) return;
  backdrop.classList.remove('hidden', 'fade-out');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (presetSubject) {
    const subjectSelect = document.querySelector('#contactForm select[name="subject"]');
    if (subjectSelect) subjectSelect.value = presetSubject;
  }
};

const closeContactModal = () => {
  const backdrop = document.getElementById('contactModalBackdrop');
  if (!backdrop) return;
  backdrop.classList.add('fade-out');
  document.body.style.overflow = '';
  setTimeout(() => {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }, 400);
};

(() => {
  const backdrop = document.getElementById('contactModalBackdrop');
  const closeBtn = document.getElementById('contactModalClose');
  if (!backdrop) return;

  closeBtn?.addEventListener('click', closeContactModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeContactModal(); });

  // Nav "Contact" link opens modal
  const contactNavLink = document.getElementById('contactNavLink');
  contactNavLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openContactModal();
  });
})();

(() => {
  const cateringBtn = document.getElementById('cateringBtn');
  const backdrop = document.getElementById('cateringPopupBackdrop');
  const closeBtn = document.getElementById('cateringPopupClose');
  const contactBtn = document.getElementById('cateringContactBtn');
  if (!cateringBtn || !backdrop) return;

  const openPopup = () => {
    backdrop.classList.remove('hidden', 'fade-out');
    backdrop.setAttribute('aria-hidden', 'false');
  };

  const closePopup = () => {
    backdrop.classList.add('fade-out');
    setTimeout(() => {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }, 400);
  };

  cateringBtn.addEventListener('click', openPopup);
  closeBtn?.addEventListener('click', closePopup);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePopup(); });

  contactBtn?.addEventListener('click', () => {
    closePopup();
    setTimeout(() => openContactModal('Custom Catering'), 450);
  });
})();

/* ─── Contact Form ─── */

(() => {
  const contactForm = document.getElementById('contactForm');
  const contactMessage = document.getElementById('contactMessage');
  if (!contactForm) return;

  const setContactMessage = (text, kind = '') => {
    if (!contactMessage) return;
    contactMessage.textContent = text;
    contactMessage.classList.remove('error', 'success');
    if (kind) contactMessage.classList.add(kind);
  };

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const subject = String(formData.get('subject') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    const message = String(formData.get('message') ?? '').trim();

    if (!subject) {
      setContactMessage('Please select a topic.', 'error');
      return;
    }
    if (!name) {
      setContactMessage('Please enter your name.', 'error');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactMessage('Please enter a valid email address.', 'error');
      return;
    }
    if (!message) {
      setContactMessage('Please enter your message.', 'error');
      return;
    }

    const submitBtn = document.getElementById('contactSubmitBtn');
    submitBtn?.classList.add('is-loading');
    submitBtn && (submitBtn.disabled = true);

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'contact',
          payload: { subject, name, email, phone, message, createdAt: new Date().toISOString() }
        })
      });

      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Failed');

      setContactMessage('Thank you! Your message has been sent.', 'success');
      contactForm.reset();
    } catch {
      setContactMessage('Could not send your message right now. Please try again.', 'error');
    } finally {
      submitBtn?.classList.remove('is-loading');
      submitBtn && (submitBtn.disabled = false);
    }
  });
})();

/* ─── Cancel Flow ─── */

(() => {
  const params = new URLSearchParams(window.location.search);
  const cancelToken = params.get('cancel');
  const modifyToken = params.get('modify');

  if (!cancelToken && !modifyToken) return;

  const CANCEL_ICONS = {
    check: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="25" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M14.1 27.2 21.7 34.8 37.9 18.6"/></svg>',
    info:  '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="25" fill="none" stroke="currentColor" stroke-width="2"/><line x1="26" y1="24" x2="26" y2="37" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="16" r="2.2" fill="currentColor"/></svg>',
    clock: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="25" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="26,14 26,27 33,32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x:     '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="25" fill="none" stroke="currentColor" stroke-width="2"/><line x1="18" y1="18" x2="34" y2="34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="34" y1="18" x2="18" y2="34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
  };

  const backdrop    = document.getElementById('cancelModalBackdrop');
  const panelConfirm = document.getElementById('cancelPanelConfirm');
  const panelResult  = document.getElementById('cancelPanelResult');
  const keepBtn     = document.getElementById('cancelModalKeepBtn');
  const confirmBtn  = document.getElementById('cancelModalConfirmBtn');
  const doneBtn     = document.getElementById('cancelModalDoneBtn');
  const resultIcon  = document.getElementById('cancelResultIcon');
  const resultTitle = document.getElementById('cancelResultTitle');
  const resultLead  = document.getElementById('cancelResultLead');

  const closeCancelModal = () => {
    if (!backdrop) return;
    backdrop.classList.add('fade-out');
    document.body.style.overflow = '';
    setTimeout(() => {
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }, 400);
  };

  const showResult = ({ icon, iconClass, title, lead }) => {
    panelConfirm?.classList.add('hidden');
    panelResult?.classList.remove('hidden');
    if (resultIcon) { resultIcon.className = `cancel-modal-icon ${iconClass}`; resultIcon.innerHTML = icon; }
    if (resultTitle) resultTitle.textContent = title;
    if (resultLead) resultLead.innerHTML = lead;
  };

  if (cancelToken) {
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);

    if (backdrop) {
      backdrop.classList.remove('hidden', 'fade-out');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    keepBtn?.addEventListener('click', closeCancelModal, { once: true });
    backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeCancelModal(); });
    doneBtn?.addEventListener('click', closeCancelModal);

    confirmBtn?.addEventListener('click', async () => {
      if (!confirmBtn) return;
      confirmBtn.classList.add('is-loading');
      confirmBtn.disabled = true;

      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'cancelByToken', token: cancelToken })
        });
        const result = await response.json();

        if (result.ok) {
          const dateObj = result.date ? parseDateKey(result.date) : null;
          const prettyDateStr = dateObj
            ? dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' })
            : (result.date || '');
          showResult({
            icon: CANCEL_ICONS.check,
            iconClass: 'cancel-icon-success',
            title: 'Reservation Canceled',
            lead: `Your reservation on <strong>${prettyDateStr}</strong> at <strong>${result.time}</strong> has been successfully canceled.`
          });
        } else if (result.error === 'already_canceled') {
          showResult({
            icon: CANCEL_ICONS.info,
            iconClass: 'cancel-icon-info',
            title: 'Already Canceled',
            lead: 'This reservation has already been canceled.'
          });
        } else {
          showResult({
            icon: CANCEL_ICONS.x,
            iconClass: 'cancel-icon-error',
            title: 'Link Not Found',
            lead: 'This cancellation link is no longer valid. Please contact us at <a href="mailto:sf@oklavacafe.com">sf@oklavacafe.com</a> for assistance.'
          });
        }
      } catch {
        showResult({
          icon: CANCEL_ICONS.x,
          iconClass: 'cancel-icon-error',
          title: 'Something Went Wrong',
          lead: 'We couldn\'t process your request right now. Please contact us at <a href="mailto:sf@oklavacafe.com">sf@oklavacafe.com</a>.'
        });
      } finally {
        confirmBtn.classList.remove('is-loading');
        confirmBtn.disabled = false;
      }
    }, { once: true });
  }

  if (modifyToken) {
    window.history.replaceState({}, '', window.location.pathname + '#reservation');
    const reservationSection = document.getElementById('reservation');
    if (reservationSection) {
      window.addEventListener('load', () => {
        setTimeout(() => scrollToSection(reservationSection), 500);
      }, { once: true });
    }
  }
})();

