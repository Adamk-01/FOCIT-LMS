import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  Award, 
  ChevronRight, 
  AlertCircle, 
  RefreshCw, 
  CheckCircle2, 
  FileText, 
  HelpCircle, 
  ArrowLeft,
  Percent,
  TrendingUp,
  Sparkles
} from 'lucide-react';
import { apiClient } from '../lib/api';

export const GradebookPage = () => {
  const { courseId = 'CSC204' } = useParams();

  // Fetch course grade report with SWR cache
  const { 
    data: report, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['course-grades', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/courses/${courseId}/grades`);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const items = report?.items || [];
  const cumulativePercentage = report?.cumulativePercentage ?? 89;
  const overallLetter = report?.overallLetter ?? 'A';
  const courseCode = report?.courseCode || 'CSC 204';
  const courseTitle = report?.courseTitle || 'Data Structures and Algorithms';

  const getLetterBadgeStyle = (letter) => {
    switch (letter) {
      case 'A':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'B':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'C':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      default:
        return 'bg-rose-100 text-rose-800 border-rose-300';
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" />
        <p className="text-gray-600 font-medium">Aggregating gradebook items from Headless Moodle...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">Unable to Load Grade Report</h2>
        <p className="text-sm text-red-700">
          {error?.response?.data?.error || 'A network error occurred while aggregating your gradebook items.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-[#0a1142] text-white rounded-xl text-xs font-bold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Dynamic Breadcrumbs (Screen 6 in ui_template.jpeg) */}
      <nav aria-label="Breadcrumbs" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li>
            <Link to={`/courses/${courseId}`} className="hover:text-[#0a1142] transition-colors">
              {courseCode}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            Gradebook
          </li>
        </ol>
      </nav>

      {/* 2. Top Header & Metric Banner (Screen 6 in template) */}
      <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
            <Award size={14} className="text-[#0a1142]" />
            <span>OFFICIAL ACADEMIC TRANSCRIPT RECORD</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
            User Report: {courseCode} — {courseTitle}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">
            Student: John Doe (Level 200, Computer Science) • Harmattan Semester 2026/2027
          </p>
        </div>

        {/* Course Total Score Gauge */}
        <div className="bg-gradient-to-br from-[#0a1142] to-[#16258f] rounded-2xl p-5 text-white shadow-md flex items-center gap-5 min-w-[260px]">
          <div className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center font-extrabold text-2xl text-[#ffb81c]">
            {overallLetter}
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-gray-300 font-semibold uppercase tracking-wider">Course Total</p>
            <p className="text-2xl font-extrabold text-white">{cumulativePercentage}%</p>
            <p className="text-[11px] text-emerald-300 flex items-center gap-1">
              <CheckCircle2 size={11} />
              <span>Good Academic Standing</span>
            </p>
          </div>
        </div>
      </header>

      {/* 3. Performance Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-[#0a1142] rounded-xl">
            <TrendingUp size={22} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Weighted Score</p>
            <p className="text-lg font-extrabold text-[#0a1142]">{cumulativePercentage}%</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-700 rounded-xl">
            <FileText size={22} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Graded Components</p>
            <p className="text-lg font-extrabold text-gray-900">{items.length} Evaluated</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
            <Sparkles size={22} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Grade Classification</p>
            <p className="text-lg font-extrabold text-emerald-700">First Class Track</p>
          </div>
        </div>
      </div>

      {/* 4. Accessible Tabular Gradebook Matrix (Screen 6 in ui_template.jpeg) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0a1142] font-display">
            Assessment Breakdown & Grade Items
          </h2>
          <span className="text-xs text-gray-500 font-medium">
            Aggregated via Headless Moodle REST Core
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <caption className="sr-only">Student assessment grades for {courseCode}</caption>
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-600 font-bold uppercase text-[11px] tracking-wider">
                <th scope="col" className="py-3.5 px-6">Grade Item</th>
                <th scope="col" className="py-3.5 px-4 text-center">Weight</th>
                <th scope="col" className="py-3.5 px-4 text-center">Grade</th>
                <th scope="col" className="py-3.5 px-4 text-center">Range</th>
                <th scope="col" className="py-3.5 px-4 text-center">Percentage</th>
                <th scope="col" className="py-3.5 px-4 text-center">Letter</th>
                <th scope="col" className="py-3.5 px-6">Feedback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-blue-50/20 transition-colors">
                  <th scope="row" className="py-4 px-6 font-bold text-gray-900">
                    <div className="flex items-center gap-2.5">
                      {item.category === 'QUIZ' ? (
                        <HelpCircle size={16} className="text-[#0a1142] shrink-0" />
                      ) : (
                        <FileText size={16} className="text-amber-600 shrink-0" />
                      )}
                      <span>{item.name}</span>
                    </div>
                  </th>
                  <td className="py-4 px-4 text-center font-medium text-gray-600">
                    {item.weightPercent}%
                  </td>
                  <td className="py-4 px-4 text-center font-bold text-[#0a1142]">
                    {Number(item.grade).toFixed(2)}
                  </td>
                  <td className="py-4 px-4 text-center text-gray-500">
                    0.00–{Number(item.maxGrade).toFixed(2)}
                  </td>
                  <td className="py-4 px-4 text-center font-extrabold text-emerald-700">
                    {item.percentage}%
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getLetterBadgeStyle(item.letterGrade)}`}>
                      {item.letterGrade}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-gray-600 text-xs italic leading-relaxed">
                    {item.feedback || 'No comments recorded.'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold border-t-2 border-gray-200 text-gray-900">
                <th scope="row" className="py-4 px-6 uppercase text-xs tracking-wider text-[#0a1142]">
                  Course Total
                </th>
                <td className="py-4 px-4 text-center">100%</td>
                <td className="py-4 px-4 text-center text-[#0a1142]">
                  {(items.reduce((acc, curr) => acc + curr.grade, 0)).toFixed(2)}
                </td>
                <td className="py-4 px-4 text-center text-gray-500">0.00–100.00</td>
                <td className="py-4 px-4 text-center text-emerald-700 font-extrabold text-base">
                  {cumulativePercentage}%
                </td>
                <td className="py-4 px-4 text-center">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-black border ${getLetterBadgeStyle(overallLetter)}`}>
                    {overallLetter}
                  </span>
                </td>
                <td className="py-4 px-6 text-xs text-gray-500 font-medium">
                  Authoritative semester grade point calculation.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
