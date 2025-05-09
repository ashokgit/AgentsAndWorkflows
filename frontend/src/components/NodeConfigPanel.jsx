import React, { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Divider from '@mui/material/Divider';
import Modal from '@mui/material/Modal';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import axios from 'axios';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import LinkIcon from '@mui/icons-material/Link';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import LLMForm from './NodeConfigPanelForms/LLMForm';
import ModelConfigForm from './NodeConfigPanelForms/ModelConfigForm';
import CodeForm from './NodeConfigPanelForms/CodeForm';
import WebhookActionForm from './NodeConfigPanelForms/WebhookActionForm';
import ApiConsumerForm from './NodeConfigPanelForms/ApiConsumerForm';
import WebhookTriggerForm from './NodeConfigPanelForms/WebhookTriggerForm';
import InputNodeForm from './NodeConfigPanelForms/InputNodeForm';
import GenericNodeForm from './NodeConfigPanelForms/GenericNodeForm';

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
    const [waitingForWebhookData, setWaitingForWebhookData] = useState(false);
    const [testDataSending, setTestDataSending] = useState(false);

    useEffect(() => {
        if (!open) return;

        // Initialize form data from node
        if (node) {
            setFormData({ ...node.data });

            // Check if this node is waiting for webhook data during testing
            if (node.type === 'webhook_trigger' && node.data?.status === 'Waiting') {
                setWaitingForWebhookData(true);
            } else {
                setWaitingForWebhookData(false);
            }
        }
    }, [node, open]);

    // Check for node status changes to detect when webhook is waiting for data
    useEffect(() => {
        if (!open || !node) return;

        if (node.type === 'webhook_trigger' && node.data?.status === 'Waiting') {
            setWaitingForWebhookData(true);
        } else if (waitingForWebhookData && node.data?.status !== 'Waiting') {
            setWaitingForWebhookData(false);
        }
    }, [node?.data?.status, open, node, waitingForWebhookData]);

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

    const handleTestLLM = async () => {
        if (!node || node.type !== 'llm') return;

        // Check if model is specified or if a model_config_id is selected
        if (!formData.model && !formData.model_config_id) {
            setFieldErrors(prev => ({ ...prev, model: 'Model configuration is required for testing' }));
            return;
        }

        setTestState({
            loading: true,
            result: null,
            error: null
        });

        try {
            // Get all workflow nodes to support model_config lookup and template variables
            const allNodes = nodes?.map(n => ({
                id: n.id,
                type: n.type,
                data: n.data
            })) || [];

            // Use a relative URL path for the backend API that works with Vite proxy
            const response = await axios.post('/api/node/llm/test', {
                node_data: formData,
                workflow_nodes: allNodes
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                validateStatus: false // To handle all status codes properly
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
                    status: 'success'
                });
            } else {
                setTestState({
                    loading: false,
                    result: null,
                    error: response.data.error || 'Test failed'
                });

                // Update node with error status
                onUpdate(node.id, {
                    testSuccess: false,
                    status: 'failed'
                });
            }
        } catch (error) {
            setTestState({
                loading: false,
                result: null,
                error: error.response?.data?.detail || error.message || 'Test failed'
            });

            // Update node with error status
            onUpdate(node.id, {
                testSuccess: false,
                status: 'failed'
            });
        }
    };

    // Helper function to send test data
    const handleSendTestData = async () => {
        if (!formData.webhook_id) return;

        setTestDataSending(true);
        try {
            // Ensure the webhook path is correct (should be /api/webhooks/...)
            let webhookPath = '';
            if (formData.webhook_id.includes('/api/webhooks/')) {
                webhookPath = formData.webhook_id;
            } else if (formData.webhook_id.startsWith('/')) {
                webhookPath = `/api/webhooks${formData.webhook_id}`;
            } else {
                webhookPath = `/api/webhooks/${formData.webhook_id}`;
            }

            // Send test data
            const testData = {
                event: "test.event",
                data: {
                    user_id: "12345",
                    email: "test@example.com",
                    name: "Test User",
                    timestamp: new Date().toISOString()
                }
            };

            const response = await axios.post(webhookPath, testData);

            // Update UI to show success
            if (response.data.success) {
                alert("Test data sent successfully! Workflow execution will continue.");
            } else {
                alert("Webhook received the data but reported an issue: " + response.data.message);
            }
        } catch (error) {
            console.error("Error sending test data:", error);
            alert(`Error: ${error.response?.data?.detail || error.message}`);
        } finally {
            setTestDataSending(false);
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
                return <LLMForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    fieldErrors={fieldErrors}
                    testState={testState}
                    handleTestLLM={handleTestLLM}
                    NodeInputSelector={NodeInputSelector}
                    DraggableTextField={DraggableTextField}
                />;
            case 'model_config':
                return <ModelConfigForm
                    node={node}
                    formData={formData}
                    commonTextFieldProps={commonTextFieldProps}
                    fieldErrors={fieldErrors}
                    testState={testState}
                    handleTestModelConfig={handleTestModelConfig}
                />;
            case 'code':
                return <CodeForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    NodeInputSelector={NodeInputSelector}
                    DraggableTextField={DraggableTextField}
                />;
            case 'webhook_action':
                return <WebhookActionForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    fieldErrors={fieldErrors}
                    jsonValidity={jsonValidity}
                    NodeInputSelector={NodeInputSelector}
                    DraggableTextField={DraggableTextField}
                />;
            case 'api_consumer':
                return <ApiConsumerForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    fieldErrors={fieldErrors}
                    setFieldErrors={setFieldErrors}
                    jsonValidity={jsonValidity}
                    apiTestState={apiTestState}
                    setApiTestState={setApiTestState}
                    NodeInputSelector={NodeInputSelector}
                    DraggableTextField={DraggableTextField}
                    isValidJson={isValidJson}
                    onUpdate={onUpdate}
                />;
            case 'webhook_trigger':
                return <WebhookTriggerForm
                    node={node}
                    formData={formData}
                    setFormData={setFormData}
                    commonTextFieldProps={commonTextFieldProps}
                    workflowId={workflowId}
                    onUpdate={onUpdate}
                    waitingForWebhookData={waitingForWebhookData}
                    testDataSending={testDataSending}
                    handleSendTestData={handleSendTestData}
                />;
            case 'input':
            case 'default':
                return <InputNodeForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    NodeInputSelector={NodeInputSelector}
                />;
            default:
                return <GenericNodeForm
                    node={node}
                    formData={formData}
                    nodes={nodes}
                    edges={edges}
                    commonTextFieldProps={commonTextFieldProps}
                    NodeInputSelector={NodeInputSelector}
                />;
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