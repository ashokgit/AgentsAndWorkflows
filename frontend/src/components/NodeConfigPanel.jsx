import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import RefreshIcon from '@mui/icons-material/Refresh';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import LinkIcon from '@mui/icons-material/Link';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

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

// New component for displaying available inputs from previous nodes
const NodeInputSelector = ({ node, nodes, edges }) => {
    const [expanded, setExpanded] = useState(false);
    const [availableInputs, setAvailableInputs] = useState([]);

    // Find all nodes that connect to this node (input nodes)
    useEffect(() => {
        if (!node || !nodes || !edges) return;

        // Find all edges where this node is the target
        const incomingEdges = edges.filter(edge => edge.target === node.id);

        // Get all source nodes from these edges
        const inputNodes = incomingEdges.map(edge =>
            nodes.find(n => n.id === edge.source)
        ).filter(Boolean);

        // Extract output data from these nodes (excluding model_config nodes)
        const inputs = inputNodes
            .filter(inputNode => inputNode.type !== 'model_config') // Filter out model_config nodes
            .map(inputNode => {
                let outputData = {};

                // Extract different data based on node type
                switch (inputNode.type) {
                    case 'llm':
                        outputData = { text: 'LLM Response' };
                        break;
                    case 'webhook_trigger':
                        outputData = inputNode.data?.last_payload || { event: 'webhook.event', data: { placeholder: 'value' } };
                        break;
                    case 'code':
                        outputData = { result: 'Code Output' };
                        break;
                    default:
                        outputData = inputNode.data || {};
                }

                // Create structured output data
                return {
                    nodeId: inputNode.id,
                    nodeName: inputNode.data?.label || inputNode.type,
                    nodeType: inputNode.type,
                    data: outputData
                };
            });

        setAvailableInputs(inputs);
    }, [node, nodes, edges]);

    // Function to generate reference key for a data path
    const generateRefKey = (nodeId, path) => {
        return `{{${nodeId}.${path}}}`;
    };

    // Recursive function to render input fields
    const renderInputFields = (data, nodeId, path = '', level = 0) => {
        if (!data || typeof data !== 'object') {
            const refKey = generateRefKey(nodeId, path);
            return (
                <ListItem
                    key={path}
                    sx={{
                        pl: 2 + level * 2,
                        py: 0.5,
                        cursor: 'grab',
                        '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' }
                    }}
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', refKey);
                        e.dataTransfer.effectAllowed = 'copy';
                    }}
                >
                    <DragIndicatorIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                    <ListItemText
                        primary={path.split('.').pop() || 'value'}
                        secondary={String(data)}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption', sx: { wordBreak: 'break-all' } }}
                    />
                    <Tooltip title="Copy reference">
                        <IconButton
                            size="small"
                            onClick={() => navigator.clipboard.writeText(refKey)}
                        >
                            <LinkIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </ListItem>
            );
        }

        return Object.entries(data).map(([key, value]) => {
            const currentPath = path ? `${path}.${key}` : key;

            if (typeof value === 'object' && value !== null) {
                return (
                    <React.Fragment key={currentPath}>
                        <ListItem
                            sx={{
                                pl: 2 + level * 2,
                                py: 0.5,
                                cursor: 'grab',
                                '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' }
                            }}
                            draggable
                            onDragStart={(e) => {
                                const refKey = generateRefKey(nodeId, currentPath);
                                e.dataTransfer.setData('text/plain', refKey);
                                e.dataTransfer.effectAllowed = 'copy';
                            }}
                        >
                            <DragIndicatorIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                            <ListItemText
                                primary={key}
                                primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
                            />
                            <Tooltip title="Copy reference">
                                <IconButton
                                    size="small"
                                    onClick={() => {
                                        const refKey = generateRefKey(nodeId, currentPath);
                                        navigator.clipboard.writeText(refKey);
                                    }}
                                >
                                    <LinkIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </ListItem>
                        {renderInputFields(value, nodeId, currentPath, level + 1)}
                    </React.Fragment>
                );
            } else {
                return renderInputFields(value, nodeId, currentPath, level);
            }
        });
    };

    if (availableInputs.length === 0) {
        return null;
    }

    return (
        <Box sx={{ mt: 3, mb: 2 }}>
            <Paper
                variant="outlined"
                sx={{ borderRadius: 1, overflow: 'hidden' }}
            >
                <Button
                    fullWidth
                    onClick={() => setExpanded(!expanded)}
                    endIcon={expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                    sx={{
                        justifyContent: 'space-between',
                        textTransform: 'none',
                        p: 1.5,
                        borderRadius: 0
                    }}
                >
                    <Typography variant="subtitle2">
                        Available Inputs ({availableInputs.length})
                    </Typography>
                </Button>
                <Collapse in={expanded}>
                    <Divider />
                    <Box sx={{ maxHeight: '250px', overflow: 'auto' }}>
                        {availableInputs.map((input, index) => (
                            <Box key={input.nodeId} sx={{ mb: 2 }}>
                                <Typography
                                    variant="subtitle2"
                                    sx={{ px: 2, py: 1, bgcolor: 'background.default' }}
                                >
                                    {input.nodeName} ({input.nodeType})
                                </Typography>

                                {/* Add option to drag the entire node data at once */}
                                <ListItem
                                    sx={{
                                        pl: 2,
                                        py: 0.5,
                                        cursor: 'grab',
                                        bgcolor: 'rgba(25, 118, 210, 0.08)',
                                        '&:hover': { bgcolor: 'rgba(25, 118, 210, 0.12)' }
                                    }}
                                    draggable
                                    onDragStart={(e) => {
                                        const refKey = `{{${input.nodeId}}}`;
                                        e.dataTransfer.setData('text/plain', refKey);
                                        e.dataTransfer.effectAllowed = 'copy';
                                    }}
                                >
                                    <DragIndicatorIcon fontSize="small" sx={{ mr: 1, color: 'primary.main' }} />
                                    <Tooltip
                                        title={
                                            <pre style={{ margin: 0, fontSize: '0.8rem', maxHeight: '200px', overflow: 'auto' }}>
                                                {JSON.stringify(input.data, null, 2)}
                                            </pre>
                                        }
                                        arrow
                                        placement="right"
                                    >
                                        <ListItemText
                                            primary="Entire node data"
                                            secondary="Drag to use all data from this node"
                                            primaryTypographyProps={{
                                                variant: 'body2',
                                                fontWeight: 'bold',
                                                color: 'primary.main'
                                            }}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Copy reference to all data">
                                        <IconButton
                                            size="small"
                                            color="primary"
                                            onClick={() => {
                                                const refKey = `{{${input.nodeId}}}`;
                                                navigator.clipboard.writeText(refKey);
                                            }}
                                        >
                                            <LinkIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </ListItem>

                                <List dense disablePadding>
                                    {renderInputFields(input.data, input.nodeId)}
                                </List>
                                {index < availableInputs.length - 1 && <Divider />}
                            </Box>
                        ))}
                    </Box>
                    <Divider />
                    <Box sx={{ p: 1.5, bgcolor: 'background.default' }}>
                        <Typography variant="caption" color="text.secondary">
                            Drag "Entire node data" to use all data or individual fields as needed.
                            Click <LinkIcon fontSize="inherit" /> to copy references.
                        </Typography>
                    </Box>
                </Collapse>
            </Paper>
        </Box>
    );
};

// Modify text field to support drag and drop
const DraggableTextField = ({ value, onChange, onBlur, ...props }) => {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!isDragOver) setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const droppedText = e.dataTransfer.getData('text/plain');
        if (droppedText) {
            // Get current cursor position
            const cursorPosition = e.target.selectionStart;

            // Insert at cursor position
            const newValue = value.substring(0, cursorPosition) + droppedText + value.substring(cursorPosition);

            // Create a synthetic event object
            const syntheticEvent = {
                target: {
                    value: newValue,
                    name: props.name
                }
            };

            onChange(syntheticEvent);

            // Trigger onBlur to save changes
            if (onBlur) {
                onBlur(syntheticEvent);
            }
        }
    };

    return (
        <TextField
            {...props}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            InputProps={{
                ...props.InputProps,
                sx: {
                    ...(props.InputProps?.sx || {}),
                    ...(isDragOver && {
                        border: '2px dashed #1976d2',
                        backgroundColor: 'rgba(25, 118, 210, 0.08)',
                    })
                }
            }}
        />
    );
};

function NodeConfigPanel({ node, onUpdate, onClose, open, nodes, onCreateEdge, onRemoveEdge, workflowId, edges }) {
    const [formData, setFormData] = useState({});
    const [jsonValidity, setJsonValidity] = useState({ headers: true, body: true });
    const [fieldErrors, setFieldErrors] = useState({});
    const [testState, setTestState] = useState({
        loading: false,
        result: null,
        error: null
    });
    const [apiTestState, setApiTestState] = useState({
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
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

                        <TextField
                            label="Name"
                            name="node_name"
                            value={formData.node_name || ''}
                            placeholder="Give this LLM node a descriptive name"
                            {...commonTextFieldProps}
                        />

                        <DraggableTextField
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
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

                        <TextField
                            label="Name"
                            name="node_name"
                            value={formData.node_name || ''}
                            placeholder="Give this code node a descriptive name"
                            {...commonTextFieldProps}
                        />

                        <DraggableTextField
                            label="Python Code"
                            name="code"
                            multiline
                            rows={10}
                            value={formData.code || ''}
                            placeholder={'def execute(input_data):\n    # Access input with input_data["key"]\n    return {"processed_value": ...}'}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />
                        <FormHelperText sx={{ ml: '10px' }}>Input available as `input_data` dict. Drag node outputs to use them.</FormHelperText>
                    </>
                );
            case 'webhook_action':
                return (
                    <>
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

                        <TextField
                            label="Name"
                            name="node_name"
                            value={formData.node_name || ''}
                            placeholder="Give this webhook a descriptive name"
                            {...commonTextFieldProps}
                        />

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
                                onBlur={handleBlur}
                            >
                                <MenuItem value="POST">POST</MenuItem>
                                <MenuItem value="GET">GET</MenuItem>
                                <MenuItem value="PUT">PUT</MenuItem>
                                <MenuItem value="DELETE">DELETE</MenuItem>
                                <MenuItem value="PATCH">PATCH</MenuItem>
                            </Select>
                        </FormControl>
                        <DraggableTextField
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
                        <DraggableTextField
                            label="Body (JSON)"
                            name="body"
                            multiline
                            rows={6}
                            value={formData.body || ''}
                            error={!jsonValidity.body || !!fieldErrors.body}
                            helperText={!jsonValidity.body ? 'Invalid JSON' : fieldErrors.body || 'Defaults to node input if blank. Drag node outputs to create a custom body.'}
                            placeholder={'{ "key": "value" } '}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />
                    </>
                );
            case 'api_consumer':
                return (
                    <>
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

                        <TextField
                            label="Name"
                            name="node_name"
                            value={formData.node_name || ''}
                            placeholder="Give this API consumer a descriptive name"
                            {...commonTextFieldProps}
                        />

                        <TextField
                            label="API Endpoint URL"
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
                                value={formData.method || 'GET'}
                                onChange={handleChange}
                                onBlur={handleBlur}
                            >
                                <MenuItem value="GET">GET</MenuItem>
                                <MenuItem value="POST">POST</MenuItem>
                                <MenuItem value="PUT">PUT</MenuItem>
                                <MenuItem value="DELETE">DELETE</MenuItem>
                                <MenuItem value="PATCH">PATCH</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl fullWidth margin="normal" size="small">
                            <InputLabel id="auth-type-select-label">Authentication Type</InputLabel>
                            <Select
                                labelId="auth-type-select-label"
                                label="Authentication Type"
                                name="auth_type"
                                value={formData.auth_type || 'none'}
                                onChange={handleChange}
                                onBlur={handleBlur}
                            >
                                <MenuItem value="none">None</MenuItem>
                                <MenuItem value="api_key">API Key</MenuItem>
                                <MenuItem value="bearer">Bearer Token</MenuItem>
                                <MenuItem value="basic">Basic Auth</MenuItem>
                                <MenuItem value="oauth2">OAuth 2.0</MenuItem>
                                <MenuItem value="custom">Custom</MenuItem>
                            </Select>
                        </FormControl>

                        {formData.auth_type === 'api_key' && (
                            <>
                                <TextField
                                    label="API Key Name"
                                    name="api_key_name"
                                    value={formData.api_key_name || ''}
                                    placeholder="X-API-Key"
                                    {...commonTextFieldProps}
                                />
                                <TextField
                                    label="API Key Value"
                                    name="api_key_value"
                                    type="password"
                                    value={formData.api_key_value || ''}
                                    placeholder="your-api-key-here"
                                    {...commonTextFieldProps}
                                />
                                <FormControl fullWidth margin="normal" size="small">
                                    <InputLabel id="api-key-location-label">API Key Location</InputLabel>
                                    <Select
                                        labelId="api-key-location-label"
                                        label="API Key Location"
                                        name="api_key_location"
                                        value={formData.api_key_location || 'header'}
                                        onChange={handleChange}
                                        onBlur={handleBlur}
                                    >
                                        <MenuItem value="header">Header</MenuItem>
                                        <MenuItem value="query">Query Parameter</MenuItem>
                                    </Select>
                                </FormControl>
                            </>
                        )}

                        {formData.auth_type === 'bearer' && (
                            <TextField
                                label="Bearer Token"
                                name="bearer_token"
                                type="password"
                                value={formData.bearer_token || ''}
                                placeholder="your-bearer-token-here"
                                {...commonTextFieldProps}
                            />
                        )}

                        {formData.auth_type === 'basic' && (
                            <>
                                <TextField
                                    label="Username"
                                    name="basic_username"
                                    value={formData.basic_username || ''}
                                    {...commonTextFieldProps}
                                />
                                <TextField
                                    label="Password"
                                    name="basic_password"
                                    type="password"
                                    value={formData.basic_password || ''}
                                    {...commonTextFieldProps}
                                />
                            </>
                        )}

                        {formData.auth_type === 'oauth2' && (
                            <>
                                <TextField
                                    label="Token URL"
                                    name="oauth_token_url"
                                    type="url"
                                    value={formData.oauth_token_url || ''}
                                    placeholder="https://example.com/oauth/token"
                                    {...commonTextFieldProps}
                                />
                                <TextField
                                    label="Client ID"
                                    name="oauth_client_id"
                                    value={formData.oauth_client_id || ''}
                                    {...commonTextFieldProps}
                                />
                                <TextField
                                    label="Client Secret"
                                    name="oauth_client_secret"
                                    type="password"
                                    value={formData.oauth_client_secret || ''}
                                    {...commonTextFieldProps}
                                />
                                <TextField
                                    label="Scope"
                                    name="oauth_scope"
                                    value={formData.oauth_scope || ''}
                                    placeholder="read write"
                                    {...commonTextFieldProps}
                                />
                            </>
                        )}

                        <DraggableTextField
                            label="Query Parameters (JSON)"
                            name="query_params"
                            multiline
                            rows={3}
                            value={formData.query_params || '{}'}
                            error={!isValidJson(formData.query_params || '{}') || !!fieldErrors.query_params}
                            helperText={!isValidJson(formData.query_params || '{}') ? 'Invalid JSON' : fieldErrors.query_params || 'Parameters to add to the URL query string'}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />

                        <DraggableTextField
                            label="Headers (JSON)"
                            name="headers"
                            multiline
                            rows={3}
                            value={formData.headers || '{}'}
                            error={!jsonValidity.headers || !!fieldErrors.headers}
                            helperText={!jsonValidity.headers ? 'Invalid JSON' : fieldErrors.headers}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />

                        <DraggableTextField
                            label="Body (JSON)"
                            name="body"
                            multiline
                            rows={6}
                            value={formData.body || ''}
                            error={!jsonValidity.body || !!fieldErrors.body}
                            helperText={!jsonValidity.body ? 'Invalid JSON' : fieldErrors.body || 'Defaults to node input if blank. Drag node outputs to create a custom body.'}
                            placeholder={'{ "key": "value" } '}
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                            {...commonTextFieldProps}
                        />

                        <FormControl fullWidth margin="normal" size="small">
                            <InputLabel id="response-handling-label">Response Handling</InputLabel>
                            <Select
                                labelId="response-handling-label"
                                label="Response Handling"
                                name="response_handling"
                                value={formData.response_handling || 'json'}
                                onChange={handleChange}
                                onBlur={handleBlur}
                            >
                                <MenuItem value="json">Parse as JSON</MenuItem>
                                <MenuItem value="text">Raw Text</MenuItem>
                                <MenuItem value="binary">Binary Data</MenuItem>
                            </Select>
                            <FormHelperText>How to process the API response</FormHelperText>
                        </FormControl>

                        <TextField
                            label="Timeout (ms)"
                            name="timeout"
                            type="number"
                            value={formData.timeout || '30000'}
                            placeholder="30000"
                            helperText="Maximum time to wait for response (milliseconds)"
                            {...commonTextFieldProps}
                        />

                        <FormControl fullWidth margin="normal" size="small">
                            <InputLabel id="retry-policy-label">Retry Policy</InputLabel>
                            <Select
                                labelId="retry-policy-label"
                                label="Retry Policy"
                                name="retry_policy"
                                value={formData.retry_policy || 'none'}
                                onChange={handleChange}
                                onBlur={handleBlur}
                            >
                                <MenuItem value="none">No Retries</MenuItem>
                                <MenuItem value="simple">Simple (3 retries)</MenuItem>
                                <MenuItem value="exponential">Exponential Backoff</MenuItem>
                            </Select>
                            <FormHelperText>How to handle request failures</FormHelperText>
                        </FormControl>

                        <Button
                            variant="contained"
                            color="primary"
                            sx={{ mt: 2 }}
                            onClick={async () => {
                                try {
                                    // Reset previous test results
                                    setApiTestState({
                                        loading: true,
                                        result: null,
                                        error: null
                                    });

                                    // Validate URL
                                    if (!formData.url) {
                                        setFieldErrors(prev => ({ ...prev, url: 'API URL is required for testing.' }));
                                        setApiTestState({
                                            loading: false,
                                            result: null,
                                            error: 'API URL is required'
                                        });
                                        return;
                                    }

                                    // Collect API config data from form
                                    const apiConfig = {
                                        url: formData.url,
                                        method: formData.method || 'GET',
                                        headers: formData.headers || '{}',
                                        body: formData.body || '',
                                        query_params: formData.query_params || '{}',
                                        auth_type: formData.auth_type || 'none',
                                        timeout: formData.timeout || 30000,
                                        response_handling: formData.response_handling || 'json'
                                    };

                                    // Add auth details based on the selected auth type
                                    if (formData.auth_type === 'api_key') {
                                        apiConfig.api_key_name = formData.api_key_name;
                                        apiConfig.api_key_value = formData.api_key_value;
                                        apiConfig.api_key_location = formData.api_key_location || 'header';
                                    } else if (formData.auth_type === 'bearer') {
                                        apiConfig.bearer_token = formData.bearer_token;
                                    } else if (formData.auth_type === 'basic') {
                                        apiConfig.basic_username = formData.basic_username;
                                        apiConfig.basic_password = formData.basic_password;
                                    } else if (formData.auth_type === 'oauth2') {
                                        apiConfig.oauth_token_url = formData.oauth_token_url;
                                        apiConfig.oauth_client_id = formData.oauth_client_id;
                                        apiConfig.oauth_client_secret = formData.oauth_client_secret;
                                        apiConfig.oauth_scope = formData.oauth_scope;
                                    }

                                    // Send the test request
                                    const response = await axios.post('/api/api_consumer/test', apiConfig);

                                    // Update state with the result
                                    if (response.data) {
                                        setApiTestState({
                                            loading: false,
                                            result: response.data,
                                            error: null
                                        });

                                        // Update the node with testSuccess flag
                                        onUpdate(node.id, {
                                            testSuccess: true,
                                            // Add a timestamp for last successful test
                                            lastTestedAt: new Date().toISOString()
                                        });
                                    } else {
                                        throw new Error('No response data returned');
                                    }
                                } catch (error) {
                                    console.error("API test error:", error);
                                    setApiTestState({
                                        loading: false,
                                        result: null,
                                        error: error.response?.data?.detail || error.message
                                    });

                                    // Clear testSuccess flag if it exists
                                    if (formData.testSuccess) {
                                        onUpdate(node.id, { testSuccess: false });
                                    }
                                }
                            }}
                            disabled={apiTestState.loading}
                            startIcon={apiTestState.loading ? <CircularProgress size={20} /> : null}
                        >
                            {apiTestState.loading ? 'Testing...' : 'Test API Connection'}
                        </Button>

                        {apiTestState.result && (
                            <Alert severity="success" sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Typography variant="subtitle2">
                                        API Test Successful!
                                        <span style={{
                                            backgroundColor: '#4caf50',
                                            color: 'white',
                                            padding: '2px 8px',
                                            borderRadius: '10px',
                                            fontSize: '0.75rem',
                                            marginLeft: '8px'
                                        }}>
                                            Verified
                                        </span>
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                        {formData.lastTestedAt ? `Last tested: ${new Date(formData.lastTestedAt).toLocaleString()}` : ''}
                                    </Typography>
                                </Box>
                                <Typography variant="body2">
                                    Status: {apiTestState.result.status_code}
                                </Typography>
                                <Box sx={{ mt: 1, p: 1, maxHeight: '150px', overflow: 'auto', bgcolor: 'background.paper', borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                    <pre style={{ margin: 0 }}>
                                        {typeof apiTestState.result.response === 'object'
                                            ? JSON.stringify(apiTestState.result.response, null, 2)
                                            : apiTestState.result.response}
                                    </pre>
                                </Box>
                            </Alert>
                        )}

                        {apiTestState.error && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Typography variant="subtitle2">
                                        API Test Failed
                                        <span style={{
                                            backgroundColor: '#f44336',
                                            color: 'white',
                                            padding: '2px 8px',
                                            borderRadius: '10px',
                                            fontSize: '0.75rem',
                                            marginLeft: '8px'
                                        }}>
                                            Error
                                        </span>
                                    </Typography>
                                </Box>
                                <Typography variant="body2">{apiTestState.error}</Typography>
                            </Alert>
                        )}
                    </>
                );
            case 'webhook_trigger':
                const webhookId = formData.webhook_id || 'Generating...';
                const hasWebhookData = !!formData.last_payload;
                const needsWorkflowSave = !formData.webhook_id && !workflowId;

                return (
                    <>
                        <TextField
                            label="Webhook Name"
                            name="webhook_name"
                            value={formData.webhook_name || ''}
                            placeholder="Give this webhook a descriptive name"
                            {...commonTextFieldProps}
                            sx={{ mb: 2 }}
                        />

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
                                {needsWorkflowSave &&
                                    <span style={{
                                        backgroundColor: '#f44336',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '0.75rem',
                                        marginLeft: '8px'
                                    }}>
                                        Save Required
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
                                <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="success"
                                        onClick={() => {
                                            const curlCommand = `curl -X POST ${window.location.origin}/webhooks/${webhookId} \\
-H "Content-Type: application/json" \\
-d '{
  "event": "test.event",
  "data": {
    "user_id": "12345",
    "email": "test@example.com",
    "name": "Test User"
  },
  "timestamp": "${new Date().toISOString()}"
}'`;
                                            navigator.clipboard.writeText(curlCommand);
                                            alert("Curl command copied to clipboard. Paste it in your terminal to test the webhook.");
                                        }}
                                    >
                                        Copy Test Command
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
                                        {needsWorkflowSave ? 'Save Required' : 'Waiting'}
                                    </span>
                                }
                            </Typography>

                            <Box
                                sx={{
                                    p: 2,
                                    backgroundColor: '#f5f5f5',
                                    borderRadius: 1,
                                    mb: 2,
                                    mt: 2,
                                    maxHeight: '300px',
                                    overflow: 'auto',
                                    border: hasWebhookData ? '1px solid #e0e0e0' :
                                        (needsWorkflowSave ? '1px dashed #f44336' : '1px dashed #9e9e9e')
                                }}
                            >
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                    {formData.last_payload ?
                                        JSON.stringify(formData.last_payload, null, 2) :
                                        (needsWorkflowSave ?
                                            'Save your workflow first to register webhook and receive data.' :
                                            'No data received yet. Send a webhook to this URL to see the payload.')
                                    }
                                </pre>
                            </Box>

                            <Paper
                                elevation={1}
                                sx={{
                                    mt: 1,
                                    p: 1,
                                    bgcolor: needsWorkflowSave ? '#fff0f0' : '#f0f4ff',
                                    borderRadius: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    border: needsWorkflowSave ? '1px dashed #f44336' : '1px dashed #2196f3',
                                    marginBottom: '10px'
                                }}
                            >
                                <Typography variant="caption" sx={{
                                    fontWeight: 'bold',
                                    color: needsWorkflowSave ? '#d32f2f' : '#1976d2'
                                }}>
                                    <span role="img" aria-label="info">
                                        {needsWorkflowSave ? '⚠️' : 'ℹ️'}
                                    </span>
                                    {needsWorkflowSave
                                        ? ' Save workflow to register webhook and enable data reception'
                                        : ' External webhook data may need a manual refresh'
                                    }
                                </Typography>
                            </Paper>

                            <Button
                                variant="outlined"
                                color="info"
                                size="small"
                                startIcon={<RefreshIcon />}
                                onClick={async () => {
                                    if (needsWorkflowSave) {
                                        alert("Please save your workflow first to register this webhook.");
                                        return;
                                    }

                                    if (formData.webhook_id && node) {
                                        try {
                                            // Try to get workflow ID from props, URL path, or node data
                                            const currentWorkflowId = workflowId ||
                                                window.location.pathname.split('/').pop() ||
                                                formData.workflow_id;

                                            if (!currentWorkflowId) {
                                                console.error("Could not determine workflow ID for refresh");
                                                alert("Could not determine workflow ID. Try saving the workflow first.");
                                                return;
                                            }

                                            console.log("Manually refreshing webhook data for workflow:", currentWorkflowId);
                                            // Fetch the current workflow to get latest node data
                                            const response = await axios.get(`/api/workflows/${currentWorkflowId}`);
                                            const workflow = response.data;

                                            if (!workflow || !workflow.nodes) {
                                                console.error("No workflow data returned");
                                                return;
                                            }

                                            // Find this node in the workflow
                                            const updatedNode = workflow.nodes.find(n => n.id === node.id);
                                            if (updatedNode && updatedNode.data?.last_payload) {
                                                console.log("Found updated webhook data:", updatedNode.data.last_payload);
                                                // Update parent component state
                                                onUpdate(node.id, {
                                                    last_payload: updatedNode.data.last_payload,
                                                    dataLoaded: true
                                                });
                                                // Also update local formData state
                                                setFormData(prevFormData => ({
                                                    ...prevFormData,
                                                    last_payload: updatedNode.data.last_payload,
                                                    dataLoaded: true
                                                }));
                                            } else {
                                                console.log("No webhook data found in updated node");

                                                // Try to get webhook data directly from the debug endpoint
                                                try {
                                                    const webhookDebugResponse = await axios.get('/api/webhooks/debug');
                                                    const webhookData = webhookDebugResponse.data;

                                                    if (formData.webhook_id && webhookData.webhook_payloads[formData.webhook_id]) {
                                                        console.log("Found data directly in webhook_payloads:",
                                                            webhookData.webhook_payloads[formData.webhook_id]);

                                                        // Update with data from webhook_payloads
                                                        onUpdate(node.id, {
                                                            last_payload: webhookData.webhook_payloads[formData.webhook_id],
                                                            dataLoaded: true
                                                        });

                                                        // Also update local formData state
                                                        setFormData(prevFormData => ({
                                                            ...prevFormData,
                                                            last_payload: webhookData.webhook_payloads[formData.webhook_id],
                                                            dataLoaded: true
                                                        }));

                                                        return; // Success, no need to show alert
                                                    }

                                                    // No data found in webhook_payloads either
                                                    const webhookEntries = Object.entries(webhookData.webhook_mappings || {})
                                                        .filter(([, mapping]) => mapping.node_id === node.id)
                                                        .map(([webhookId]) => webhookId);

                                                    if (webhookEntries.length > 0) {
                                                        console.log("Found webhook mappings for this node:", webhookEntries);
                                                        alert(`Webhook is registered (ID: ${formData.webhook_id}) but no data has been sent to it yet. Try sending data to this webhook URL first.`);
                                                    } else {
                                                        console.log("No webhook mappings found for this node");
                                                        alert(`No webhook data found. Make sure to send data to this webhook URL: ${window.location.origin}/webhooks/${formData.webhook_id}`);
                                                    }
                                                } catch (debugError) {
                                                    console.error("Error fetching webhook debug data:", debugError);
                                                    alert(`No webhook data found. Try sending data to this webhook URL: ${window.location.origin}/webhooks/${formData.webhook_id}`);
                                                }
                                            }
                                        } catch (error) {
                                            console.error("Error manually refreshing webhook data:", error);
                                            alert(`Error refreshing webhook data: ${error.message}`);
                                        }
                                    }
                                }}
                                disabled={!formData.webhook_id && !needsWorkflowSave}
                                sx={{ mr: 1 }}
                            >
                                {needsWorkflowSave ? 'Save Workflow First' : 'Refresh Data'}
                            </Button>

                            {hasWebhookData && (
                                <Button
                                    variant="outlined"
                                    color="warning"
                                    size="small"
                                    onClick={() => {
                                        if (window.confirm("Clear the current webhook data?")) {
                                            onUpdate(node.id, { last_payload: null });
                                            // Also update local formData state
                                            setFormData(prevFormData => ({
                                                ...prevFormData,
                                                last_payload: null
                                            }));
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
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

                        <TextField
                            label="Name"
                            name="node_name"
                            value={formData.node_name || formData.label || node.type || ''}
                            placeholder="Give this node a descriptive name"
                            {...commonTextFieldProps}
                        />
                        <Typography variant="caption" color="textSecondary">Node name for identification in the workflow.</Typography>
                    </>
                )
            default:
                return (
                    <>
                        <NodeInputSelector node={node} nodes={nodes} edges={edges} />

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