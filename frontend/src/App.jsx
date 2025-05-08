import React from 'react';
import WorkflowEditor from './components/WorkflowEditor';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
// Remove the old App.css import if it primarily contained layout styles handled by MUI now
// import './App.css'; 

// Define a basic theme (can customize later)
const theme = createTheme({
    palette: {
        mode: 'light', // Start with light mode
        primary: {
            main: '#1976d2', // Example primary color (blue)
        },
        secondary: {
            main: '#dc004e', // Example secondary color (pink)
        },
    },
    // Customize other theme aspects like typography, spacing, components etc.
});

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline /> {/* Normalize CSS and apply background color */}
            {/* Use Box for basic layout structure if needed, replacing App div */}
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                {/* AppBar can go here eventually */}
                {/* WorkflowEditor will fill the remaining space */}
                <WorkflowEditor />
            </Box>
        </ThemeProvider>
    );
}

export default App; 