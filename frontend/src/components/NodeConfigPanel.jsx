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
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import axios from 'axios';

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

function NodeConfigPanel({ node, onUpdate, onClose, open, nodes, onCreateEdge, onRemoveEdge }) {
    const [formData, setFormData] = useState({});
    const [jsonValidity, setJsonValidity] = useState({ headers: true, body: true });
    const [fieldErrors, setFieldErrors] = useState({});
    const [testState, setTestState] = useState({
        loading: false,
        result: null,
        error: null
    });

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
        // Only validate model for LLM node if no model_config_id is selected
        if (name === 'model' && ((node.type === 'llm' && !formData.model_config_id) || node.type === 'model_config') && !value) {
            return 'Model is required.';
        }
        if (name === 'config_name' && node.type === 'model_config' && !value) {
            return 'Configuration name is required.';
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

        // If this is a model_config_id change in an LLM node
        if (name === 'model_config_id' && node?.type === 'llm') {
            if (value) {
                // Create a connection between the model config and this LLM node
                if (onCreateEdge) {
                    onCreateEdge(value, node.id);
                }
            } else {
                // If model_config_id is being set to empty, remove any existing connection
                // between the LLM node and any model config node
                if (onRemoveEdge && formData.model_config_id) {
                    onRemoveEdge(formData.model_config_id, node.id);
                }
            }
        }
    }, [fieldErrors, node, onCreateEdge, onRemoveEdge, formData.model_config_id]);

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

    const handleTestModelConfig = async () => {
        if (!node || node.type !== 'model_config') return;

        // Check if model is specified
        if (!formData.model) {
            setFieldErrors(prev => ({ ...prev, model: 'Model is required for testing' }));
            return;
        }

        setTestState({
            loading: true,
            result: null,
            error: null
        });

        try {
            // Use a relative URL path instead of full URL with baseUrl
            // This will properly use the Vite dev server proxy
            const response = await axios.post('/api/model_config/test', {
                model: formData.model,
                api_key: formData.api_key,
                api_base: formData.api_base,
                config_name: formData.config_name,
                test_message: 'Hi'
            });

            if (response.data.status === 'success') {
                setTestState({
                    loading: false,
                    result: response.data,
                    error: null
                });

                // Update the node with testSuccess flag
                onUpdate(node.id, {
                    testSuccess: true,
                    // If there's no config_name, use the model name as a fallback
                    config_name: formData.config_name || `${formData.model}`
                });
            } else {
                setTestState({
                    loading: false,
                    result: null,
                    error: response.data.error || 'Test failed'
                });

                // Clear testSuccess flag if it exists
                if (formData.testSuccess) {
                    onUpdate(node.id, { testSuccess: false });
                }
            }
        } catch (error) {
            setTestState({
                loading: false,
                result: null,
                error: error.response?.data?.detail || error.message || 'Test failed'
            });

            // Clear testSuccess flag if it exists
            if (formData.testSuccess) {
                onUpdate(node.id, { testSuccess: false });
            }
        }
    };

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
                // Get all model configurations from nodes
                const modelConfigs = nodes?.filter(n => n.type === 'model_config').map(n => ({
                    id: n.id,
                    name: n.data?.config_name || 'Unnamed Config',
                    model: n.data?.model
                })) || [];

                // Add validation warning if no model_config_id is selected and no model is specified
                const hasNoModel = !formData.model && !formData.model_config_id;
                const showModelWarning = hasNoModel && modelConfigs.length > 0;

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
                        {modelConfigs.length > 0 && (
                            <FormControl fullWidth margin="normal" size="small">
                                <InputLabel id="model-config-select-label">Use Model Configuration</InputLabel>
                                <Select
                                    labelId="model-config-select-label"
                                    name="model_config_id"
                                    value={formData.model_config_id || ''}
                                    label="Use Model Configuration"
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    error={showModelWarning}
                                >
                                    <MenuItem value="">
                                        <em>Configure manually</em>
                                    </MenuItem>
                                    {modelConfigs.map(config => (
                                        <MenuItem key={config.id} value={config.id}>
                                            {config.name} ({config.model})
                                        </MenuItem>
                                    ))}
                                </Select>
                                <FormHelperText error={showModelWarning}>
                                    {showModelWarning
                                        ? "LLM nodes should use a model configuration or specify a model"
                                        : formData.model_config_id
                                            ? "Using shared model configuration"
                                            : "Or configure model manually below"}
                                </FormHelperText>
                            </FormControl>
                        )}

                        {!formData.model_config_id && (
                            <>
                                <TextField
                                    label="Model"
                                    name="model"
                                    required
                                    value={formData.model || ''}
                                    error={!!fieldErrors.model || showModelWarning}
                                    helperText={fieldErrors.model || (showModelWarning ? "Model is required" : "")}
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
                        )}
                    </>
                );
            case 'model_config':
                return (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Configure a model that can be used across multiple LLM nodes
                        </Typography>
                        <TextField
                            label="Configuration Name"
                            name="config_name"
                            required
                            value={formData.config_name || ''}
                            error={!!fieldErrors.config_name}
                            helperText={fieldErrors.config_name || "Give this configuration a name to reference it"}
                            placeholder="e.g., GPT-4, Claude-3-Sonnet"
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
                        />
                        <TextField
                            label="API Base URL (Optional)"
                            name="api_base"
                            type="url"
                            value={formData.api_base || ''}
                            placeholder="e.g., http://localhost:11434/v1"
                            {...commonTextFieldProps}
                        />

                        <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={handleTestModelConfig}
                                disabled={testState.loading || !formData.model}
                                startIcon={testState.loading ? <CircularProgress size={20} /> : null}
                            >
                                {testState.loading ? 'Testing...' : 'Test Configuration'}
                            </Button>

                            {testState.result && (
                                <Alert severity="success" sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2">Test Successful!</Typography>
                                    <Typography variant="body2">
                                        Response: {testState.result.response.substring(0, 100)}
                                        {testState.result.response.length > 100 ? '...' : ''}
                                    </Typography>
                                    {testState.result.usage && (
                                        <Typography variant="caption" display="block">
                                            Tokens: {testState.result.usage.total_tokens || 'N/A'}
                                        </Typography>
                                    )}
                                </Alert>
                            )}

                            {testState.error && (
                                <Alert severity="error" sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2">Test Failed</Typography>
                                    <Typography variant="body2">{testState.error}</Typography>
                                </Alert>
                            )}
                        </Box>
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
            case 'webhook_trigger':
                const webhookId = formData.webhook_id || 'Generating...';
                const hasWebhookData = !!formData.last_payload;
                return (
                    <>
                        <Box sx={{ mb: 3, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                Webhook URL {formData.webhook_id &&
                                    <span style={{
                                        backgroundColor: '#4caf50',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '0.75rem',
                                        marginLeft: '8px'
                                    }}>
                                        Ready
                                    </span>
                                }
                            </Typography>
                            <Typography
                                sx={{
                                    p: 1,
                                    backgroundColor: 'background.paper',
                                    borderRadius: 1,
                                    fontFamily: 'monospace',
                                    wordBreak: 'break-all',
                                    border: formData.webhook_id ? '1px solid #e0e0e0' : '1px dashed #f44336'
                                }}
                            >
                                {formData.webhook_id ?
                                    `${window.location.origin}/webhooks/${webhookId}` :
                                    'Save your workflow first to generate a webhook URL'
                                }
                            </Typography>
                            {formData.webhook_id && (
                                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/webhooks/${webhookId}`)}
                                    >
                                        Copy URL
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="info"
                                        onClick={() => window.open(`${window.location.origin}/webhooks/${webhookId}`, '_blank')}
                                    >
                                        Open in New Tab
                                    </Button>
                                </Box>
                            )}
                        </Box>

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                                Last Received Payload
                                {hasWebhookData ?
                                    <span style={{
                                        backgroundColor: '#4caf50',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '0.75rem',
                                        marginLeft: '8px'
                                    }}>
                                        Data Received
                                    </span> :
                                    <span style={{
                                        backgroundColor: '#9e9e9e',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '0.75rem',
                                        marginLeft: '8px'
                                    }}>
                                        Waiting
                                    </span>
                                }
                            </Typography>
                            <Box
                                sx={{
                                    p: 2,
                                    backgroundColor: '#f5f5f5',
                                    borderRadius: 1,
                                    mb: 2,
                                    maxHeight: '300px',
                                    overflow: 'auto',
                                    border: hasWebhookData ? '1px solid #e0e0e0' : '1px dashed #9e9e9e'
                                }}
                            >
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                    {formData.last_payload ?
                                        JSON.stringify(formData.last_payload, null, 2) :
                                        'No data received yet. Send a webhook to this URL to see the payload.'}
                                </pre>
                            </Box>

                            <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => {
                                    if (formData.webhook_id) {
                                        const testPayload = {
                                            message: "This is a test payload",
                                            timestamp: new Date().toISOString(),
                                            test: true,
                                            sample_data: {
                                                string_value: "example text",
                                                number_value: 42,
                                                boolean_value: true,
                                                array_value: [1, 2, 3],
                                                nested_object: {
                                                    key: "value"
                                                }
                                            }
                                        };

                                        axios.post(`/webhooks/${formData.webhook_id}`, testPayload)
                                            .then(response => {
                                                console.log("Test webhook sent:", response.data);
                                                // The server will push this to the node via SSE
                                            })
                                            .catch(error => {
                                                console.error("Error sending test webhook:", error);
                                            });
                                    }
                                }}
                                disabled={!formData.webhook_id}
                                sx={{ mr: 1 }}
                            >
                                Send Test Webhook
                            </Button>

                            {hasWebhookData && (
                                <Button
                                    variant="outlined"
                                    color="warning"
                                    size="small"
                                    onClick={() => {
                                        if (window.confirm("Clear the current webhook data?")) {
                                            onUpdate(node.id, { last_payload: null });
                                        }
                                    }}
                                >
                                    Clear Data
                                </Button>
                            )}
                        </Box>

                        <Typography variant="subtitle2" gutterBottom>
                            How to Use Webhook Data
                        </Typography>
                        <Box sx={{ p: 2, backgroundColor: '#e3f2fd', borderRadius: 1, fontSize: '0.875rem' }}>
                            <p style={{ margin: '0 0 8px 0' }}>After receiving data, you can reference it in subsequent nodes:</p>
                            <ul style={{ margin: 0, paddingLeft: '20px' }}>
                                <li>The entire payload is passed to the next node</li>
                                <li>Access specific fields using dot notation in code nodes</li>
                                <li>Example: <code>input_data.sample_data.number_value</code></li>
                            </ul>
                        </Box>
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