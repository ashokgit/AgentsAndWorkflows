import React, { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Divider from '@mui/material/Divider';
import FormHelperText from '@mui/material/FormHelperText';
import Modal from '@mui/material/Modal';
import Paper from '@mui/material/Paper';

const modalStyle = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 500,
    maxHeight: '80vh',
    bgcolor: 'background.paper',
    boxShadow: 24,
    borderRadius: 2,
    p: 0,
    overflow: 'auto',
};

const inputStyle = {
    width: '100%',
    padding: '10px',
    marginBottom: '15px', // More spacing
    boxSizing: 'border-box',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
};

const textareaStyle = {
    ...inputStyle,
    minHeight: '100px',
    resize: 'vertical',
    fontFamily: 'monospace', // Monospace for code/json
};

const selectStyle = {
    ...inputStyle,
};

const labelStyle = {
    display: 'block',
    marginBottom: '5px',
    fontWeight: '600', // Slightly bolder
    fontSize: '14px',
    color: '#555',
};

// Header container style with better layout
const headerContainerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#f5f5f5',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    borderBottom: '1px solid #e0e0e0',
};

// Content container style
const contentContainerStyle = {
    padding: '24px',
};

const headerStyle = {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#111',
};

const subHeaderStyle = {
    fontSize: '14px',
    color: '#777',
    marginBottom: '16px',
};

const closeButtonStyle = {
    backgroundColor: '#f0f0f0',
    border: '1px solid #e0e0e0',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    color: '#666',
    '&:hover': {
        backgroundColor: '#e0e0e0',
        color: '#333',
    }
};

// Helper to safely parse JSON from textareas
const safeJsonParse = (str, fallback = {}) => {
    try {
        if (!str) return fallback;
        return JSON.parse(str) || fallback;
    } catch (e) {
        console.warn("JSON parsing error:", e);
        return fallback; // Return fallback if parsing fails
    }
};

function NodeConfigPanel({ node, onUpdate, onClose, open }) {
    const [formData, setFormData] = useState({});
    const [jsonValidity, setJsonValidity] = useState({ headers: true, body: true });
    const [fieldErrors, setFieldErrors] = useState({});

    useEffect(() => {
        if (!node) return;

        const initialData = node.data || {};
        setFormData(initialData);
        setJsonValidity({ headers: true, body: true });
        // Clear errors when node changes
        setFieldErrors({});
        // Initial validation check for webhook URL when panel opens
        if (node.type === 'webhook_action' && !initialData.url) {
            setFieldErrors(prev => ({ ...prev, url: 'Webhook URL is required.' }));
        }
        // Initial JSON validation
        if (node.type === 'webhook_action') {
            setJsonValidity({
                headers: isValidJson(initialData.headers || '{}'),
                body: isValidJson(initialData.body || '')
            });
        }
    }, [node]);

    const isValidJson = (str) => {
        if (!str || str.trim() === '' || str.trim() === '{}') return true; // Allow empty or empty object
        try {
            JSON.parse(str);
            return true;
        } catch (e) {
            return false;
        }
    };

    const validateField = (name, value) => {
        if (!node) return null;

        if (name === 'url' && node.type === 'webhook_action' && !value) {
            return 'Webhook URL is required.';
        }
        if (name === 'model' && node.type === 'llm' && !value) {
            return 'Model is required.';
        }
        if ((name === 'headers' || name === 'body') && !isValidJson(value)) {
            return 'Invalid JSON format.';
        }
        return null; // No error
    };

    const handleChange = useCallback((event) => {
        const { name, value } = event.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        if (fieldErrors[name]) {
            setFieldErrors(prev => ({ ...prev, [name]: null }));
        }
        if (name === 'headers' || name === 'body') {
            setJsonValidity(prev => ({ ...prev, [name]: isValidJson(value) }));
        }
    }, [fieldErrors]);

    const handleBlur = useCallback((event) => {
        if (!node) return;

        const { name, value } = event.target;
        const error = validateField(name, value);
        setFieldErrors(prev => ({ ...prev, [name]: error }));

        if (!error) {
            // Use validated/cleaned value for update if needed
            let valueToUpdate = value;
            if ((name === 'headers' || name === 'body')) {
                valueToUpdate = value.trim() === '' ? (name === 'headers' ? '{}' : '') : value;
            }
            onUpdate(node.id, { [name]: valueToUpdate });
        }
    }, [onUpdate, node, validateField]);

    // --- Render different forms based on node type ---
    const renderFormContent = () => {
        if (!node) return null;

        const commonTextFieldProps = {
            variant: "outlined",
            size: "small",
            fullWidth: true,
            margin: "normal",
            onChange: handleChange,
            onBlur: handleBlur,
        };

        switch (node.type) {
            case 'llm':
                return (
                    <>
                        <TextField
                            label="Prompt"
                            name="prompt"
                            multiline
                            rows={4}
                            value={formData.prompt || ''}
                            {...commonTextFieldProps}
                        />
                        <TextField
                            label="Model"
                            name="model"
                            required
                            value={formData.model || ''}
                            error={!!fieldErrors.model}
                            helperText={fieldErrors.model}
                            placeholder='e.g., gpt-4o, claude-3-sonnet-20240229'
                            {...commonTextFieldProps}
                        />
                        <TextField
                            label="API Key"
                            name="api_key"
                            type="password"
                            value={formData.api_key || ''}
                            placeholder="Uses environment variable if blank"
                            {...commonTextFieldProps}
                        // No specific validation error shown for API key
                        />
                        <TextField
                            label="API Base URL (Optional)"
                            name="api_base"
                            type="url"
                            value={formData.api_base || ''}
                            placeholder="e.g., http://localhost:11434/v1"
                            {...commonTextFieldProps}
                        />
                    </>
                );
            case 'code':
                return (
                    <>
                        <TextField
                            label="Python Code"
                            name="code"
                            multiline
                            rows={10}
                            value={formData.code || ''}
                            placeholder={'def execute(input_data):\n    # Access input with input_data["key"]\n    return {"processed_value": ...}'}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />
                        <FormHelperText sx={{ ml: '10px' }}>Input available as `input_data` dict.</FormHelperText>
                    </>
                );
            case 'webhook_action':
                return (
                    <>
                        <TextField
                            label="Webhook URL"
                            name="url"
                            type="url"
                            required
                            value={formData.url || ''}
                            error={!!fieldErrors.url}
                            helperText={fieldErrors.url}
                            {...commonTextFieldProps}
                        />
                        <FormControl fullWidth margin="normal" size="small">
                            <InputLabel id="method-select-label">HTTP Method</InputLabel>
                            <Select
                                labelId="method-select-label"
                                label="HTTP Method"
                                name="method"
                                value={formData.method || 'POST'}
                                onChange={handleChange}
                                onBlur={handleBlur} // Or maybe not needed for select?
                            >
                                <MenuItem value="POST">POST</MenuItem>
                                <MenuItem value="GET">GET</MenuItem>
                                <MenuItem value="PUT">PUT</MenuItem>
                                <MenuItem value="DELETE">DELETE</MenuItem>
                                <MenuItem value="PATCH">PATCH</MenuItem>
                            </Select>
                        </FormControl>
                        <TextField
                            label="Headers (JSON)"
                            name="headers"
                            multiline
                            rows={4}
                            value={formData.headers || '{}'}
                            error={!jsonValidity.headers || !!fieldErrors.headers}
                            helperText={!jsonValidity.headers ? 'Invalid JSON' : fieldErrors.headers}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />
                        <TextField
                            label="Body (JSON)"
                            name="body"
                            multiline
                            rows={6}
                            value={formData.body || ''}
                            error={!jsonValidity.body || !!fieldErrors.body}
                            helperText={!jsonValidity.body ? 'Invalid JSON' : fieldErrors.body || 'Defaults to node input if blank.'}
                            placeholder={'{ "key": "value" } '}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />
                    </>
                );
            case 'input':
            case 'default':
                return (
                    <>
                        <TextField
                            label="Label"
                            name="label"
                            value={formData.label || node.type || ''}
                            {...commonTextFieldProps}
                        />
                        <Typography variant="caption" color="textSecondary">Basic node label.</Typography>
                    </>
                )
            default:
                return (
                    <>
                        <Typography variant="body2" color="textSecondary">No specific configuration available for node type: {node.type}</Typography>
                        <TextField
                            label="Data (JSON - Read Only)"
                            multiline
                            rows={8}
                            value={JSON.stringify(formData, null, 2)}
                            InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', backgroundColor: '#f5f5f5' } }}
                            {...commonTextFieldProps}
                        />
                    </>
                );
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            aria-labelledby="node-config-modal-title"
        >
            <Paper sx={modalStyle}>
                <Box sx={headerContainerStyle}>
                    <Typography variant="h6" sx={headerStyle} id="node-config-modal-title">
                        {node?.data?.label || (node ? `${node.type} Settings` : 'Node Settings')}
                    </Typography>
                    <IconButton size="small" onClick={onClose} sx={closeButtonStyle}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>

                <Box sx={contentContainerStyle}>
                    <Typography sx={subHeaderStyle}>
                        Configure node parameters
                    </Typography>

                    {renderFormContent()}
                </Box>
            </Paper>
        </Modal>
    );
}

export default NodeConfigPanel; 