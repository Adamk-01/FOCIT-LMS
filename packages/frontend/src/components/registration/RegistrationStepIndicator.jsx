import React from 'react';
import { ShieldCheck, BookOpen } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Select Courses', shortLabel: 'Select' },
  { id: 2, label: 'Review Matrix', shortLabel: 'Review' },
  { id: 3, label: 'Senate Clearance', shortLabel: 'Submit' },
];

/**
 * <RegistrationStepIndicator />
 *
 * Semantic accessible navigation indicator & Senate Unit Meter for the registration wizard.
 * Uses <nav> and <ol> with aria-current="step" per WAI-ARIA authoring practices.
 */
export function RegistrationStepIndicator({
  activeStep = 1,
  setStep,
  selectedCount = 0,
  totalUnits = 0,
  minFloor = 15,
  maxCeiling = 24,
  isUnderMinimum = false,
  isOverMaximum = false,
  unitsDeficit = 0,
  unitsSurplus = 0,
  semesterName = 'Active Session',
}) {
  return (
    <header className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200/80 shadow-sm shrink-0 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0a1142]/10 text-[#0a1142] mb-1">
            <ShieldCheck size={14} className="text-[#0a1142]" aria-hidden="true" />
            <span>FOCIT Academic Administration</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0a1142] font-display tracking-tight">
            Course Registration & Senate Clearance
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 font-sans">
            Select accredited curriculum modules for {semesterName}.
          </p>
        </div>

        {/* Telemetry Credit Load Badge (Outfit font) */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-bold text-gray-500 block font-sans tracking-wider">
              Enrolled Load
            </span>
            <span
              className={`text-lg font-black font-display ${
                isUnderMinimum
                  ? 'text-amber-600'
                  : isOverMaximum
                  ? 'text-red-600'
                  : 'text-emerald-700'
              }`}
            >
              {totalUnits} / {maxCeiling} Units
            </span>
          </div>
        </div>
      </div>

      {/* Semantic Accessible 3-Step Navigation */}
      <nav aria-label="Registration Progress" className="max-w-xl mx-auto">
        <ol className="flex items-center w-full list-none p-0 m-0">
          {STEPS.map((step, idx) => {
            const isCompleted = activeStep > step.id;
            const isCurrent = activeStep === step.id;
            const isDisabled = step.id > 1 && selectedCount === 0;

            return (
              <li
                key={step.id}
                className={`flex items-center ${idx < STEPS.length - 1 ? 'flex-1' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setStep(step.id)}
                  disabled={isDisabled}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="flex items-center gap-2.5 min-h-[44px] py-1 px-1.5 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-[#0a1142] disabled:opacity-40 disabled:cursor-not-allowed group transition-all"
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black font-display transition-colors ${
                      isCompleted || isCurrent
                        ? 'bg-[#0a1142] text-[#ffb81c]'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {step.id}
                  </span>
                  <span
                    className={`text-xs font-bold font-sans transition-colors ${
                      isCurrent
                        ? 'text-[#0a1142]'
                        : isCompleted
                        ? 'text-gray-700'
                        : 'text-gray-400'
                    }`}
                  >
                    {step.shortLabel}
                  </span>
                </button>

                {idx < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-3 transition-colors ${
                      activeStep > step.id ? 'bg-[#0a1142]' : 'bg-gray-200'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Dynamic Visual Unit Gauge */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between text-xs mb-2 font-sans">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <BookOpen size={15} className="text-[#0a1142]" aria-hidden="true" />
            <span>Senate Unit Meter:</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                isUnderMinimum
                  ? 'bg-amber-100 text-amber-800'
                  : isOverMaximum
                  ? 'bg-red-100 text-red-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {isUnderMinimum
                ? `Need ${unitsDeficit} more unit(s) for final submission (Min: 15)`
                : isOverMaximum
                ? `Exceeds max ceiling by ${unitsSurplus} unit(s) (Max: ${maxCeiling})`
                : 'Optimal Unit Range (15 - 24 units)'}
            </span>
          </div>
          <span className="text-gray-500 font-bold font-display">{totalUnits} / {maxCeiling} Units</span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden relative border border-gray-200">
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
            style={{ left: `${(minFloor / maxCeiling) * 100}%` }}
            title="15 Units Minimum Senate Threshold"
          />
          <div
            className={`h-full transition-all duration-300 ${
              isUnderMinimum
                ? 'bg-amber-400'
                : isOverMaximum
                ? 'bg-red-500'
                : 'bg-emerald-500'
            }`}
            style={{
              width: `${Math.min(100, (totalUnits / maxCeiling) * 100)}%`,
            }}
          />
        </div>
      </div>
    </header>
  );
}

export default RegistrationStepIndicator;
