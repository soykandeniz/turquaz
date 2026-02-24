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
const slotGrid = document.getElementById('slotGrid');
const mealTabs = document.getElementById('mealTabs');
const dateField = document.getElementById('dateField');
const timeField = document.getElementById('timeField');
const reservationMessage = document.getElementById('reservationMessage');

const SLOT_CAPACITY = 10;
const OPEN_DAYS = 21;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzfnVWOZ2uzz5JGCcnR_IyV0OFMciQzE5Kyq59JwIGIYV28X4Yepg9rWsQ1vIooJMo9Jw/exec';

const MEALS = [
  { id: 'breakfast', label: 'Breakfast', slots: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'] },
  { id: 'lunch', label: 'Lunch', slots: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'] },
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

const toDateKey = (date) => date.toISOString().slice(0, 10);

const prettyDate = (date) => ({
  day: date.toLocaleDateString('en-US', { weekday: 'short' }),
  date: date.toLocaleDateString('en-US', { day: '2-digit' }),
  month: date.toLocaleDateString('en-US', { month: 'short' })
});

const formatDateLabel = (dateKey) => {
  if (!dateKey) {
    return 'Select Day';
  }

  const date = new Date(`${dateKey}T00:00:00`);
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
};

const setReservationDate = async (dateKey) => {
  if (!dateKey) {
    return;
  }

  const boundedDate = dateKey < reservationMinDate ? reservationMinDate : (dateKey > reservationMaxDate ? reservationMaxDate : dateKey);

  state.selectedDate = boundedDate;
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
  if (currentHour < 11) state.selectedMeal = 'breakfast';
  else if (currentHour < 16) state.selectedMeal = 'lunch';
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
    if (typeof reservationDatePicker.showPicker === 'function') {
      reservationDatePicker.showPicker();
      return;
    }
    reservationDatePicker.focus();
    reservationDatePicker.click();
  });

  resPrevDayBtn.addEventListener('click', async () => {
    await shiftReservationDate(-1);
  });

  resNextDayBtn.addEventListener('click', async () => {
    await shiftReservationDate(1);
  });

  reservationForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(reservationForm);
    const guests = Number(formData.get('guests') || 0);
    const phone = String(formData.get('phone') ?? '').trim();

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
      guests,
      note: String(formData.get('note') ?? '').trim(),
      date: state.selectedDate,
      time: state.selectedTime,
      meal: inferMealByTime(state.selectedTime),
      createdAt: new Date().toISOString()
    };

    try {
      const result = await submitReservation(payload);
      if (!result.ok) {
        throw new Error('Reservation failed');
      }

      setMessage('Your reservation has been received.', 'success');
      reservationForm.reset();
      dateField.value = state.selectedDate;
      timeField.value = state.selectedTime;
      await hydrateAvailability(state.selectedDate);
      renderSlots();
    } catch {
      setMessage('Reservation could not be saved right now. Please try again.', 'error');
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

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const targetSelector = link.getAttribute('href');
    if (!targetSelector || targetSelector === '#') {
      return;
    }

    const destination = document.querySelector(targetSelector);
    if (!destination) {
      return;
    }

    event.preventDefault();
    destination.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
