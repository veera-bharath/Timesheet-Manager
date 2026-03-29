export const APP_VERSION = '1.4.0';

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
    'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
export const SEPARATOR = '------------------------------------------------------------------------------------------------------------------------------------------------------';
export const LS_KEY = 'timesheetState_v1';
export const RECURRING_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DAY_IDX_TO_NAME = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
export const SEARCH_PAGE_SIZE = 10;

export const DEFAULT_LEAVE_TYPES = [
    { id: 'offshore-holiday', label: 'Offshore Holiday', paid: false },
    { id: 'sick-leave',       label: 'Sick Leave',       paid: false },
    { id: 'planned-leave',    label: 'Planned Leave',    paid: true  },
];

export const DEFAULT_TICKET_TYPES = [
    { id: 'jira',        label: 'Jira',         color: '#c8c8c8', hasPrefix: false, prefixText: '' },
    { id: 'servicedesk', label: 'Service Desk',  color: '#fbbf24', hasPrefix: true,  prefixText: '(Service desk) ' },
];

export const state = {
    reportTitle: 'Booked hours in Jira and Service Desk',
    employeeName: '',
    weekValue: '',
    allDaysByDate: {},
    days: [],
    lastOpenedDateByWeek: {},
    recurringTasks: [],
    dailyTargetMins: 480,
    ticketTypes: [],
    leaveTypes: [],
    errorLog: [],
    errorLogRetentionDays: 30,
    changelog: [],
};
