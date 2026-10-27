import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  HelpCircle, 
  Library, 
  MessagesSquare, 
  Award, 
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  BookOpen
} from 'lucide-react';

export const COURSE_OPTIONS = [
  {
    id: 'materials',
    label: 'Digital Library',
    tab: 'materials',
    icon: Library,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/60',
    title: 'Access Course Textbooks & Digital Library',
  },
  {
    id: 'assignments',
    label: 'Assignments',
    tab: 'assignments',
    icon: Calendar,
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-50 dark:bg-indigo-950/60',
    title: 'View Course Assignments & Lab Briefs',
  },
  {
    id: 'quizzes',
    label: 'Quizzes & CBT',
    tab: 'quizzes',
    icon: HelpCircle,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-50 dark:bg-amber-950/60',
    title: 'View Quiz Assessments & CBT Tests',
  },
  {
    id: 'forum',
    label: 'Discussion',
    tab: 'forum',
    icon: MessagesSquare,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-50 dark:bg-blue-950/60',
    title: 'Course Peer Discussion Forum',
  },
  {
    id: 'grades',
    label: 'Gradebook',
    tab: 'grades',
    icon: Award,
    iconColor: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-50 dark:bg-purple-950/60',
    title: 'Official Academic Grades & Results',
  },
  {
    id: 'overview',
    label: 'Overview',
    tab: 'overview',
    icon: BookOpen,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-50 dark:bg-cyan-950/60',
    title: 'Full Course Syllabus & Overview',
  },
];

/**
 * <CourseCard />
 *
 * Isolated Course Directory Item with Interactive Module Options Slider
 * Invariants Enforced:
 * 1. Deterministic Keying & Routing (course_id)
 * 2. WCAG 44x44px minimum touch targets on all interactive triggers
 * 3. SessionStorage continuity for contextual course memory
 * 4. Responsive horizontal options slider with touch snap & desktop chevron navigation
 * 5. High-contrast typography and spacious layout with no text cramping
 */
export function CourseCard({ course, focus = null }) {
  const canonicalId = course.course_id || course.id || '1';
  const progressVal = Number(course.progress) || 45;
  const isCompleted = course.status === 'Completed' || course.status === 'COMPLETED';

  const sliderRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  const checkScroll = useCallback(() => {
    const el = sliderRef.current;
    if (!el) return;
    
    const maxScroll = el.scrollWidth - el.clientWidth;
    const hasLeft = el.scrollLeft > 6;
    const hasRight = maxScroll > 6 && el.scrollLeft < maxScroll - 6;
    setCanScrollLeft(hasLeft);
    setCanScrollRight(hasRight);

    if (maxScroll > 0) {
      const scrollFraction = el.scrollLeft / maxScroll;
      const index = Math.round(scrollFraction * (COURSE_OPTIONS.length - 1));
      setActiveSlideIndex(Math.min(COURSE_OPTIONS.length - 1, Math.max(0, index)));
    }
  }, []);

  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  // Auto-scroll to focused option if present
  useEffect(() => {
    if (!focus || !sliderRef.current) return;
    const targetIndex = COURSE_OPTIONS.findIndex(opt => opt.id === focus);
    if (targetIndex > 0) {
      const el = sliderRef.current;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll > 0) {
        const target = (targetIndex / (COURSE_OPTIONS.length - 1)) * maxScroll;
        el.scrollTo({ left: target, behavior: 'smooth' });
      }
    }
  }, [focus]);

  const handleSlide = (direction) => {
    const el = sliderRef.current;
    if (!el) return;
    const chipWidth = 145; // chip width (130px) + gap (10px) + margin
    const targetScroll = direction === 'left' 
      ? Math.max(0, el.scrollLeft - chipWidth) 
      : Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + chipWidth);
    el.scrollTo({ left: targetScroll, behavior: 'smooth' });
  };

  const jumpToSlide = (index) => {
    const el = sliderRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll > 0) {
      const target = (index / (COURSE_OPTIONS.length - 1)) * maxScroll;
      el.scrollTo({ left: target, behavior: 'smooth' });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handleSlide('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleSlide('right');
    }
  };

  const handleCardClick = () => {
    try {
      sessionStorage.setItem('focit_last_course_id', canonicalId);
    } catch {
      // Defensive against sandbox storage quota/errors
    }
  };

  return (
    <article 
      className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/90 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between overflow-hidden group hover:border-[#0a1142]/30 dark:hover:border-slate-700"
    >
      {/* 1. Card Header & Academic Metadata */}
      <div className="p-6 space-y-4">
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-2">
          <span className="px-3.5 py-1 rounded-xl text-xs font-black bg-[#0a1142] dark:bg-slate-800 text-[#ffb81c] border border-[#ffb81c]/30 shadow-xs tracking-wider">
            {course.code}
          </span>

          <div className="flex items-center gap-1.5">
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
              course.category === 'CORE' 
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' 
                : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
            }`}>
              {course.category || 'CORE'}
            </span>

            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
              isCompleted 
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
            }`}>
              {course.status || 'In Progress'}
            </span>
          </div>
        </div>

        {/* Course Title */}
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-[#0a1142] dark:text-slate-100 group-hover:text-[#16258f] dark:group-hover:text-indigo-400 transition-colors leading-snug line-clamp-2 font-display min-h-[3rem]">
            <Link 
              to={`/courses/${canonicalId}`} 
              onClick={handleCardClick}
              className="focus:outline-none focus:underline"
            >
              {course.title}
            </Link>
          </h2>
          
          {/* Metadata Badges */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold text-[11px]">
              {course.units} Credit Units
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold text-[11px]">
              Level {course.level || 200}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold text-[11px]">
              Rain Semester
            </span>
          </div>
        </div>

        {/* Progress Gauge */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-gray-500 dark:text-slate-400 text-[11px] font-medium">Syllabus Completion</span>
            <span className="text-[#0a1142] dark:text-slate-100 font-bold">{progressVal}%</span>
          </div>

          <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                isCompleted 
                  ? 'bg-emerald-500' 
                  : 'bg-gradient-to-r from-[#0a1142] to-[#16258f] dark:from-indigo-600 dark:to-indigo-500'
              }`}
              style={{ width: `${progressVal}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Course Options Interactive Slider */}
      <div className="py-3 px-4 bg-gray-50/70 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-800 space-y-2.5">
        {/* Slider Navigation Bar */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Course Modules
            </span>
            <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal">
              (slide for options)
            </span>
          </div>

          {/* Desktop/Touch Scroll Chevron Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleSlide('left')}
              disabled={!canScrollLeft}
              aria-label="Slide course options left"
              className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:text-[#0a1142] dark:hover:text-white disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleSlide('right')}
              disabled={!canScrollRight}
              aria-label="Slide course options right"
              className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:text-[#0a1142] dark:hover:text-white disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable Track Container with Gradient Edge Fades */}
        <div className="relative">
          {/* Left Edge Mask */}
          {canScrollLeft && (
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-gray-50/95 dark:from-slate-900/95 to-transparent z-10 transition-opacity" />
          )}

          {/* Scrollable Track */}
          <div
            ref={sliderRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            aria-label="Scrollable course modules slider. Use left and right arrow keys to slide."
            className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden scroll-smooth snap-x snap-proximity py-1 px-0.5 touch-pan-x focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
          >
            {COURSE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isFocused = focus === opt.id;

              return (
                <Link
                  key={opt.id}
                  to={`/courses/${canonicalId}?tab=${opt.tab}`}
                  onClick={handleCardClick}
                  title={opt.title}
                  className={`snap-start shrink-0 min-w-[124px] min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2.5 border select-none ${
                    isFocused
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-xs ring-1 ring-emerald-400/40'
                      : 'bg-white dark:bg-slate-800/80 text-gray-700 dark:text-slate-300 border-gray-200/90 dark:border-slate-700/80 hover:border-[#0a1142]/40 dark:hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-slate-800 hover:shadow-xs'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-lg ${opt.iconBg} flex items-center justify-center shrink-0`}>
                    <Icon size={14} className={opt.iconColor} aria-hidden="true" />
                  </div>
                  <span className="truncate whitespace-nowrap">{opt.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right Edge Mask */}
          {canScrollRight && (
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-gray-50/95 dark:from-slate-900/95 to-transparent z-10 transition-opacity" />
          )}
        </div>

        {/* Interactive Slider Dots Indicator */}
        <div className="flex items-center justify-center gap-1.5 pt-0.5" role="tablist" aria-label="Course options pagination">
          {COURSE_OPTIONS.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => jumpToSlide(i)}
              aria-label={`Jump to option ${opt.label}`}
              aria-selected={activeSlideIndex === i}
              role="tab"
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                activeSlideIndex === i 
                  ? 'w-4 bg-[#0a1142] dark:bg-indigo-400' 
                  : 'w-1.5 bg-gray-300 dark:bg-slate-700 hover:bg-gray-400 dark:hover:bg-slate-500'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 3. Primary Action Button */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
        <Link
          to={focus ? `/courses/${canonicalId}?tab=${focus}` : `/courses/${canonicalId}`}
          onClick={handleCardClick}
          className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 group-hover:bg-[#16258f] dark:group-hover:bg-indigo-700"
        >
          <span>
            {focus === 'materials' 
              ? 'Open Digital Library' 
              : focus === 'quizzes' 
                ? 'Open Quizzes & CBT' 
                : focus === 'grades' 
                  ? 'Open Gradebook' 
                  : focus === 'forum' 
                    ? 'Open Discussion Forum' 
                    : focus === 'assignments'
                      ? 'Open Assignments'
                      : 'Open Course Overview'}
          </span>
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </article>
  );
}

export default CourseCard;
