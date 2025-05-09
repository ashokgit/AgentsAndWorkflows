import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    useReactFlow,
    ReactFlowProvider,
    MarkerType, // Import MarkerType for edge arrows
    getBezierPath, // Import for custom edge
    applyEdgeChanges, // Add this import for edge changes
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios'; // For API calls
import NodeConfigPanel from './NodeConfigPanel'; // Import the config panel
import LogDisplay from './LogDisplay'; // Import the new LogDisplay

// MUI Imports
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import BugReportIcon from '@mui/icons-material/BugReport'; // Test workflow icon
import CheckCircleIcon from '@mui/icons-material/CheckCircle'; // For tested status
import CloudOffIcon from '@mui/icons-material/CloudOff'; // For inactive status
import CloudDoneIcon from '@mui/icons-material/CloudDone'; // For active status
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';

// MUI Icons
import InputIcon from '@mui/icons-material/Input';
import NotesIcon from '@mui/icons-material/Notes'; // Default/Log
import SmartToyIcon from '@mui/icons-material/SmartToy'; // LLM
import CodeIcon from '@mui/icons-material/Code';
import SendIcon from '@mui/icons-material/Send'; // Webhook Action
import WebhookIcon from '@mui/icons-material/Webhook'; // Webhook Trigger
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AccountTreeIcon from '@mui/icons-material/AccountTree'; // Icon for App Title
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApiIcon from '@mui/icons-material/Api'; // API Consumer Icon
import FitScreenIcon from '@mui/icons-material/FitScreen'; // Fit View Icon
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InputOutlinedIcon from '@mui/icons-material/InputOutlined'; // For Inputs & Triggers
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'; // For Configuration
import LoopOutlinedIcon from '@mui/icons-material/LoopOutlined'; // For Processing
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined'; // For External Actions
import ScienceIcon from '@mui/icons-material/Science'; // Test icon

// Custom Node Components
import DefaultNode from './nodes/DefaultNode';
import InputNode from './nodes/InputNode';
import LlmNode from './nodes/LlmNode';
import CodeNode from './nodes/CodeNode';
import WebhookNode from './nodes/WebhookNode';
import WebhookInputNode from './nodes/WebhookInputNode';
import ModelConfigNode from './nodes/ModelConfigNode';
import ApiConsumerNode from './nodes/ApiConsumerNode';

const drawerWidth = 240;
const logPanelHeight = 200;

// Helper function to get icon based on node type (for palette)
const getNodeIcon = (nodeType) => {
    switch (nodeType) {
        case 'trigger': return <InputIcon />;
        case 'defaultnode': return <NotesIcon />;
        case 'llm': return <SmartToyIcon />;
        case 'code': return <CodeIcon />;
        case 'webhook_action': return <SendIcon />;
        case 'webhook_trigger': return <WebhookIcon />;
        case 'model_config': return <SettingsIcon />;
        case 'api_consumer': return <ApiIcon />;
        default: return <NotesIcon />;
    }
};

// Available node types for the palette
const nodeTypesList = [
    // Input/Triggers group
    { type: 'trigger', label: 'Input / Trigger', category: 'Inputs & Triggers' },
    { type: 'webhook_trigger', label: 'Webhook Trigger', category: 'Inputs & Triggers' },

    // Processing group
    { type: 'llm', label: 'LLM Call', category: 'Processing' },
    { type: 'code', label: 'Code Execution', category: 'Processing' },
    { type: 'defaultnode', label: 'Default / Log', category: 'Processing' },

    // External Actions group
    { type: 'webhook_action', label: 'Webhook Action', category: 'External Actions' },
    { type: 'api_consumer', label: 'API Consumer', category: 'External Actions' },

    // Configuration group
    { type: 'model_config', label: 'Model Configuration', category: 'Configuration' },
];

// Group nodes by category
const getNodesByCategory = () => {
    const categories = {};
    nodeTypesList.forEach(node => {
        if (!categories[node.category]) {
            categories[node.category] = [];
        }
        categories[node.category].push(node);
    });
    return categories;
};

// Mapping for React Flow with enhanced props
const getNodeTypes = (updateNodeData) => ({
    defaultnode: (props) => <DefaultNode {...props} />,
    trigger: (props) => <InputNode {...props} />,
    llm: (props) => <LlmNode {...props} />,
    code: (props) => <CodeNode {...props} />,
    webhook_action: (props) => <WebhookNode {...props} />,
    webhook_trigger: (props) => <WebhookInputNode {...props} updateNodeData={updateNodeData} />,
    model_config: (props) => <ModelConfigNode {...props} />,
    api_consumer: (props) => <ApiConsumerNode {...props} />,
});

// Change the id_counter to ensure it's not reset when the component re-renders
// Move it outside the component to make it truly stateful
let id_counter = 0; // Use a different name to avoid potential conflicts
const getId = () => {
    return `dndnode_${id_counter++}`;
};

// Helper function to update the ID counter based on existing nodes
const updateIdCounterFromNodes = (nodesList) => {
    if (!nodesList || nodesList.length === 0) return;

    // Find all node IDs that follow our pattern
    const dndNodeIds = nodesList
        .map(node => node.id)
        .filter(id => id.startsWith('dndnode_'));

    // Extract the numeric parts and find the maximum
    if (dndNodeIds.length > 0) {
        const numericParts = dndNodeIds.map(id => {
            const numPart = id.replace('dndnode_', '');
            return parseInt(numPart, 10);
        }).filter(num => !isNaN(num));

        if (numericParts.length > 0) {
            const maxId = Math.max(...numericParts);
            // Set the counter to one more than the maximum ID
            id_counter = maxId + 1;
            console.log(`Updated node ID counter to ${id_counter} based on existing nodes`);
        }
    }
};

// Custom edge component for model configuration connections
const ModelConfigEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {} }) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    return (
        <>
            <path
                id={id}
                style={{
                    ...style,
                    stroke: '#3f83f8',
                    strokeWidth: 2,
                    strokeDasharray: '5,5',
                }}
                className="react-flow__edge-path"
                d={edgePath}
            />
            <text>
                <textPath
                    href={`#${id}`}
                    style={{ fontSize: '10px', fill: '#3f83f8' }}
                    startOffset="50%"
                    textAnchor="middle"
                >
                    uses config
                </textPath>
            </text>
        </>
    );
};

// Add the edge type to React Flow
const edgeTypes = {
    modelConfig: ModelConfigEdge,
};

// Update default edge options to support different states
const defaultEdgeOptions = {
    animated: true,
    type: 'smoothstep',
    markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: '#757575', // Use theme color later if needed
    },
    style: {
        strokeWidth: 1.5,
        stroke: '#757575', // Use theme color later if needed
    },
};

// Define edge styles for different statuses
const getEdgeStyleForStatus = (status) => {
    switch (status) {
        case 'Success':
            return {
                stroke: '#4caf50', // Green
                strokeWidth: 2,
                animated: true
            };
        case 'Failed':
            return {
                stroke: '#f44336', // Red
                strokeWidth: 2,
                animated: false
            };
        case 'Running':
        case 'Pending':
            return {
                stroke: '#2196f3', // Blue
                strokeWidth: 2,
                animated: true
            };
        case 'Waiting':
            return {
                stroke: '#ff9800', // Orange
                strokeWidth: 2,
                animated: true,
                strokeDasharray: '5,5'
            };
        default:
            return {
                stroke: '#757575', // Default gray
                strokeWidth: 1.5,
                animated: false
            };
    }
};

// Default viewport settings - more zoomed out
const defaultViewport = {
    x: 0,
    y: 0,
    zoom: 0.65, // Lower zoom value for a more zoomed out view
};

// Helper function to get the default label for a node type
const getDefaultLabelForNodeType = (nodeType) => {
    const nodeInfo = nodeTypesList.find(n => n.type === nodeType);
    return nodeInfo ? nodeInfo.label : `${nodeType} Node`;
};

// Helper function to get category icon
const getCategoryIcon = (category) => {
    switch (category) {
        case 'Inputs & Triggers':
            return <InputOutlinedIcon fontSize="small" sx={{ color: '#4dabf5' }} />;
        case 'Processing':
            return <LoopOutlinedIcon fontSize="small" sx={{ color: '#66bb6a' }} />;
        case 'External Actions':
            return <PublishOutlinedIcon fontSize="small" sx={{ color: '#f57c00' }} />;
        case 'Configuration':
            return <SettingsOutlinedIcon fontSize="small" sx={{ color: '#ba68c8' }} />;
        default:
            return null;
    }
};

function WorkflowEditor() {
    const reactFlowWrapper = useRef(null); // Ref for drag and drop bounds
    const reactFlowInstance = useReactFlow(); // Get full reactFlow instance
    const { screenToFlowPosition, project } = reactFlowInstance; // project needed for viewport
    const [nodes, setNodes, onNodesChange] = useNodesState([]); // Start empty
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [workflowName, setWorkflowName] = useState('My Workflow');
    const [workflowId, setWorkflowId] = useState(null); // Or generate UUID
    const [runLogs, setRunLogs] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null); // State for selected node
    const [configNode, setConfigNode] = useState(null); // State for node with config modal open
    const [nodeExecutionStatus, setNodeExecutionStatus] = useState({}); // { nodeId: status }
    const eventSourceRef = useRef(null); // Ref to store the EventSource instance
    const [loadWorkflowIdInput, setLoadWorkflowIdInput] = useState(''); // State for load input
    const [availableWorkflows, setAvailableWorkflows] = useState([]); // State for available workflows
    const [selectedWorkflowId, setSelectedWorkflowId] = useState(''); // State for selected workflow from dropdown
    const [expandedCategories, setExpandedCategories] = useState({
        'Inputs & Triggers': true,
        'Processing': true,
        'External Actions': true,
        'Configuration': true
    });

    // New state for workflow activation
    const [isWorkflowActive, setIsWorkflowActive] = useState(false);
    const [isWorkflowTested, setIsWorkflowTested] = useState(false);
    const [lastTestedDate, setLastTestedDate] = useState(null);
    const [isTestingWorkflow, setIsTestingWorkflow] = useState(false); // For UI loading state

    // Toggle category expansion
    const toggleCategory = (category) => {
        setExpandedCategories(prev => ({
            ...prev,
            [category]: !prev[category]
        }));
    };

    // Function to validate the workflow nodes
    const validateWorkflow = useCallback(() => {
        // Create a map of validation errors by node ID
        const validationErrors = {};

        // Check LLM nodes for model configuration
        const modelConfigNodes = nodes.filter(n => n.type === 'model_config');

        nodes.forEach(node => {
            if (node.type === 'llm') {
                const hasOwnModel = node.data?.model;
                const hasModelConfigRef = node.data?.model_config_id && modelConfigNodes.some(n => n.id === node.data.model_config_id);

                if (!hasOwnModel && !hasModelConfigRef) {
                    validationErrors[node.id] = "LLM node needs a model configuration";
                }
            }
        });

        return validationErrors;
    }, [nodes]);

    // Effect to update node validation when nodes change
    useEffect(() => {
        const errors = validateWorkflow();

        // Update nodes with validation errors
        setNodes((nds) =>
            nds.map((node) => {
                const error = errors[node.id];
                // Avoid unnecessary updates if validation hasn't changed
                if (node.data?.validationError === error) {
                    return node;
                }
                return {
                    ...node,
                    data: {
                        ...node.data,
                        validationError: error, // Add/update validation error in node data
                    },
                };
            })
        );
    }, [nodes, validateWorkflow, setNodes]);

    // Update node data callback for the config panel
    const updateNodeData = useCallback((nodeId, newData) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === nodeId) {
                    // Ensure data exists before merging
                    const currentData = node.data || {};

                    // If node_name is being updated, use it as the label
                    let updatedData = { ...currentData, ...newData };

                    // Update the label based on different node types
                    if (newData.node_name) {
                        updatedData.label = newData.node_name;
                    } else if (newData.config_name && node.type === 'model_config') {
                        updatedData.label = newData.config_name;
                    } else if (newData.webhook_name && node.type === 'webhook_trigger') {
                        updatedData.label = newData.webhook_name;
                    }

                    return { ...node, data: updatedData };
                }
                return node;
            })
        );
    }, [setNodes]);

    const onConnect = useCallback(
        (params) => {
            // Get the source and target nodes
            const sourceNode = nodes.find(node => node.id === params.source);
            const targetNode = nodes.find(node => node.id === params.target);

            // Check if this is a connection between a model_config and an LLM node
            if (sourceNode && targetNode) {
                if (sourceNode.type === 'model_config' && targetNode.type === 'llm') {
                    // Update the LLM node to use this model configuration
                    updateNodeData(targetNode.id, { model_config_id: sourceNode.id });

                    // Create a custom edge with different styling
                    return setEdges((eds) => addEdge({
                        ...params,
                        type: 'modelConfig', // Custom edge type
                        animated: true,
                    }, eds));
                }
                else if (sourceNode.type === 'llm' && targetNode.type === 'model_config') {
                    // Update the LLM node to use this model configuration
                    updateNodeData(sourceNode.id, { model_config_id: targetNode.id });

                    // Create a custom edge with different styling
                    return setEdges((eds) => addEdge({
                        ...params,
                        type: 'modelConfig', // Custom edge type
                        animated: true,
                    }, eds));
                }
            }

            // Default edge creation for other connections
            return setEdges((eds) => addEdge(params, eds));
        },
        [setEdges, nodes, updateNodeData]
    );

    // --- Node Selection Handler ---
    const onNodeClick = useCallback((event, node) => {
        console.log("Node clicked:", node);
        // Just select the node but don't open the config panel
        setSelectedNode(node);
    }, []);

    // --- Node Double-Click Handler for Opening Config ---
    const onNodeDoubleClick = useCallback((event, node) => {
        console.log("Node double-clicked:", node);
        // Make sure the node is also selected
        setSelectedNode(node);
        // Open config panel on double-click
        setConfigNode(node);
    }, []);

    // --- Pane Click Handler (to deselect node) ---
    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
        // Don't close config modal when clicking on pane
    }, []);

    // Close modal with escape key
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && configNode) {
                setConfigNode(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [configNode]);

    // --- Drag and Drop for Adding Nodes ---
    const onDragOver = useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        async (event) => {
            event.preventDefault();

            const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
            const nodeType = event.dataTransfer.getData('application/reactflow');

            // Return early if no node type or reactFlowBounds doesn't exist
            if (!nodeType || !reactFlowBounds) return;

            const position = screenToFlowPosition({
                x: event.clientX - reactFlowBounds.left,
                y: event.clientY - reactFlowBounds.top,
            });

            const newNode = {
                id: getId(),
                type: nodeType,
                position,
                data: {
                    label: getDefaultLabelForNodeType(nodeType),
                },
            };

            // Set appropriate default names based on node type
            if (nodeType === 'model_config') {
                newNode.data.config_name = `Model Config ${newNode.id.split('_').pop()}`;
            } else if (nodeType !== 'webhook_trigger') {
                // For all other nodes except webhook_trigger (which is handled separately)
                newNode.data.node_name = getDefaultLabelForNodeType(nodeType);
            }

            // If this is a webhook_trigger node, we need to register it to get a webhook ID
            if (nodeType === 'webhook_trigger') {
                // Assign a friendly name for the webhook node
                newNode.data.webhook_name = `Webhook ${newNode.id}`;

                // If we already have a workflowId (i.e., the workflow has been saved before),
                // we can deterministically build the webhook_id so the backend recognises it
                if (workflowId) {
                    newNode.data.webhook_id = `/api/webhooks/wh_${workflowId}_${newNode.id}`;
                }

                // Simply add the node – no backend round-trip is required anymore
                setNodes((nds) => [...nds, newNode]);
            } else {
                // For non-webhook nodes, simply add the new node to the existing ones
                setNodes((nds) => {
                    // Create a proper copy to avoid reference issues
                    const newNodes = [...nds];
                    newNodes.push(newNode);
                    return newNodes;
                });
            }
        },
        [screenToFlowPosition, workflowId, setNodes]
    );

    // --- Node Type Drag Start ---
    const onDragStart = (event, nodeType) => {
        console.log("Dragging node type:", nodeType);
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';

        // Create a small drag preview
        const dragPreview = document.createElement('div');
        dragPreview.style.width = '100px';
        dragPreview.style.height = '40px';
        dragPreview.style.backgroundColor = '#f0f0f0';
        dragPreview.style.border = '1px solid #ccc';
        dragPreview.style.borderRadius = '4px';
        dragPreview.style.padding = '8px';
        dragPreview.style.display = 'flex';
        dragPreview.style.alignItems = 'center';
        dragPreview.style.justifyContent = 'center';
        dragPreview.style.fontSize = '12px';
        dragPreview.style.opacity = '0.8';
        dragPreview.textContent = nodeTypesList.find(n => n.type === nodeType)?.label || nodeType;

        // Append preview to DOM temporarily
        document.body.appendChild(dragPreview);

        // Set as drag image at mouse position
        event.dataTransfer.setDragImage(dragPreview, 50, 20);

        // Remove preview after a short delay
        setTimeout(() => {
            document.body.removeChild(dragPreview);
        }, 0);
    };

    // --- API Interaction --- 
    const handleSaveWorkflow = async () => {
        const currentWorkflowId = workflowId || `wf_${Date.now()}`;
        if (!workflowId) {
            setWorkflowId(currentWorkflowId);
        }

        const workflowData = {
            id: currentWorkflowId,
            name: workflowName,
            nodes: nodes.map(n => ({ // Map to backend format
                id: n.id,
                type: n.type || 'default', // Ensure type is present
                position: n.position,
                data: (() => {
                    // Ensure webhook_trigger nodes always carry a deterministic webhook_id so the backend recognises them
                    if (n.type === 'webhook_trigger') {
                        const newData = { ...(n.data || {}) };
                        if (!newData.webhook_id) {
                            newData.webhook_id = `/api/webhooks/wh_${currentWorkflowId}_${n.id}`;
                        }
                        return newData;
                    }
                    // Non-webhook nodes – just return existing data or a fallback label
                    return n.data || { label: n.type };
                })(),
            })),
            edges: edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle
            })),
            metadata: { /* Add viewport, etc. if needed */ }
        };

        try {
            console.log("Saving workflow:", workflowData);
            // Use relative URL for consistency with Vite proxy
            const response = await axios.post('/api/workflows', workflowData);
            alert(`Workflow saved successfully! ID: ${response.data.workflow_id}`);
            setWorkflowId(response.data.workflow_id); // Ensure ID is set after save

            // Update local nodes with deterministic webhook_id now that we know the workflowId
            setNodes(nds => nds.map(n => {
                if (n.type === 'webhook_trigger') {
                    const updatedData = { ...(n.data || {}) };
                    updatedData.webhook_id = `/api/webhooks/wh_${response.data.workflow_id}_${n.id}`;
                    return { ...n, data: updatedData };
                }
                return n;
            }));

            // Refresh the workflow list to include the newly saved workflow
            await fetchWorkflows();
        } catch (error) {
            console.error("Error saving workflow:", error);
            alert(`Error saving workflow: ${error.response?.data?.detail || error.message}`);
        }
    };

    // Function to fetch all workflows from the API
    const fetchWorkflows = async () => {
        try {
            const response = await axios.get('/api/workflows');
            setAvailableWorkflows(response.data || []);
            console.log("Fetched workflows:", response.data);
        } catch (error) {
            console.error("Error fetching workflows:", error);
        }
    };

    // Fetch workflows when the component mounts
    useEffect(() => {
        fetchWorkflows();
    }, []);

    // Update ID counter when available workflows are loaded
    useEffect(() => {
        if (availableWorkflows.length > 0) {
            // Collect all nodes from all workflows
            const allNodes = availableWorkflows.flatMap(workflow => workflow.nodes || []);
            // Update the ID counter based on all existing nodes
            updateIdCounterFromNodes(allNodes);
        }
    }, [availableWorkflows]);

    const handleLoadWorkflow = async () => {
        try {
            // Use selected workflow ID from dropdown if available, otherwise use the input field or current workflow ID
            const workflowIdToLoad = selectedWorkflowId || loadWorkflowIdInput || workflowId;
            if (!workflowIdToLoad) {
                console.error("No workflow ID to load");
                return;
            }

            const response = await axios.get(`/api/workflows/${workflowIdToLoad}`);
            if (response.data) {
                const workflow = response.data;

                // Extract nodes and edges
                const loadedNodes = workflow.nodes || [];
                let loadedEdges = workflow.edges || [];

                // Update the ID counter to avoid conflicts with existing node IDs
                updateIdCounterFromNodes(loadedNodes);

                // Reset node execution status
                setNodeExecutionStatus({});

                // Map model configuration to LLM connections with custom edge styling
                loadedEdges = loadedEdges.map(edge => {
                    // Find source and target nodes to check their types
                    const sourceNode = loadedNodes.find(node => node.id === edge.source);
                    const targetNode = loadedNodes.find(node => node.id === edge.target);

                    if (sourceNode && targetNode) {
                        // If this is a connection between model_config and llm, use custom edge type
                        if ((sourceNode.type === 'model_config' && targetNode.type === 'llm') ||
                            (sourceNode.type === 'llm' && targetNode.type === 'model_config')) {
                            return {
                                ...edge,
                                type: 'modelConfig',
                                animated: true
                            };
                        }
                    }

                    return edge;
                });

                setNodes(loadedNodes);
                setEdges(loadedEdges);
                setWorkflowName(workflow.name || 'Imported Workflow');
                setWorkflowId(workflowIdToLoad);
                console.log("Workflow loaded successfully");

                // After nodes and edges are set, explicitly call fitView to ensure all nodes are visible
                setTimeout(() => {
                    reactFlowInstance.fitView({ padding: 0.4, maxZoom: 0.8 });
                }, 50);

                // Ensure every webhook_trigger node has a deterministic webhook_id
                const webhookTriggerNodes = loadedNodes.filter(node => node.type === 'webhook_trigger');

                if (webhookTriggerNodes.length > 0) {
                    setNodes(nds => nds.map(node => {
                        if (webhookTriggerNodes.some(wn => wn.id === node.id)) {
                            const updatedData = { ...(node.data || {}) };
                            if (!updatedData.webhook_id) {
                                updatedData.webhook_id = `/api/webhooks/wh_${workflowIdToLoad}_${node.id}`;
                            }
                            if (!updatedData.webhook_name) {
                                updatedData.webhook_name = `Webhook ${node.id}`;
                            }
                            // Clean legacy flags
                            delete updatedData.needsRegistration;
                            delete updatedData.registering;

                            return { ...node, data: updatedData };
                        }
                        return node;
                    }));
                }
            } else {
                console.error("No workflow data returned");
            }
        } catch (error) {
            console.error("Error loading workflow:", error);
        }
    };

    const handleRunWorkflow = async () => {
        if (!workflowId) {
            alert("Please save or load a workflow before running.");
            return;
        }

        // Check for validation errors
        const errors = validateWorkflow();
        const errorCount = Object.keys(errors).length;

        if (errorCount > 0) {
            alert(`Cannot run workflow: ${errorCount} node${errorCount > 1 ? 's have' : ' has'} validation errors. Please fix them first.`);
            return;
        }

        if (eventSourceRef.current) {
            console.log("Closing previous SSE connection.");
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        // Clear previous logs and statuses
        setRunLogs([]); // Clear logs immediately
        setNodeExecutionStatus({}); // Clear node statuses
        // Add initial entry
        setRunLogs([{ step: "Initiating Run...", status: "Pending", timestamp: Date.now() / 1000 }]);

        try {
            const response = await axios.post(`/api/workflows/${workflowId}/run`, {});
            const runId = response.data.run_id;

            if (!runId) throw new Error("Backend did not return a run_id.");

            console.log(`Obtained run_id: ${runId}. Connecting to SSE stream...`);
            // Clear initiating message before streaming starts
            setRunLogs([]);

            const sseUrl = `/api/workflows/${workflowId}/runs/${runId}/stream`;
            const newEventSource = new EventSource(sseUrl);
            eventSourceRef.current = newEventSource;

            newEventSource.onopen = () => { /* ... */ };

            newEventSource.onmessage = (event) => {
                try {
                    const logEntry = JSON.parse(event.data);
                    if (logEntry.step === "__END__") {
                        // ... handle end ...
                        newEventSource.close();
                        eventSourceRef.current = null;
                        // Optionally reset node statuses after a short delay?
                        // setTimeout(() => setNodeExecutionStatus({}), 2000);
                        return;
                    }

                    // Update logs
                    setRunLogs(prev => [...prev, logEntry]);

                    // Update node status based on log entry
                    if (logEntry.node_id) {
                        setNodeExecutionStatus(prevStatus => ({
                            ...prevStatus,
                            [logEntry.node_id]: logEntry.status || 'Unknown' // Update status for this node
                        }));
                    }
                    // Clear status if it's the overall 'End' step
                    if (logEntry.step === 'End') {
                        // Delay clearing slightly to see final statuses
                        setTimeout(() => setNodeExecutionStatus({}), 1500);
                    }

                } catch (parseError) {
                    console.error("Error parsing SSE message data:", parseError, "Data:", event.data);
                    setRunLogs(prev => [...prev, { step: "Log Stream Error", status: "Failed", error: `Malformed message received`, timestamp: Date.now() / 1000 }]);
                }
            };

            newEventSource.onerror = (error) => {
                console.error("SSE connection error:", error);
                setRunLogs(prev => {
                    if (prev.length > 0 && prev[prev.length - 1].status === "SSE Error") return prev;
                    return [...prev, { step: "Log Stream Error", status: "SSE Error", error: "Connection failed or closed unexpectedly.", timestamp: Date.now() / 1000 }];
                });
                if (newEventSource) newEventSource.close();
                eventSourceRef.current = null;
                setNodeExecutionStatus({});
            };

        } catch (error) {
            console.error("Error initiating workflow run:", error);
            const errorMsg = error.response?.data?.detail || error.message;
            alert(`Error starting workflow run: ${errorMsg}`);
            setRunLogs([{
                "step": "Run Initiation Error",
                "status": "Failed",
                "error": errorMsg,
                "timestamp": Date.now() / 1000
            }]);
            setNodeExecutionStatus({});
        }
    };

    // Cleanup SSE connection on component unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                console.log("Closing SSE connection on component unmount.");
                eventSourceRef.current.close();
            }
        };
    }, []);

    // Close config panel if the selected node is deleted
    useEffect(() => {
        if (configNode && !nodes.find(n => n.id === configNode.id)) {
            setConfigNode(null);
        }
    }, [nodes, configNode]);

    // *** NEW: Update nodes data when execution status changes ***
    useEffect(() => {
        setNodes((nds) =>
            nds.map((node) => {
                const status = nodeExecutionStatus[node.id] || null; // Get status or null
                // Avoid unnecessary updates if status hasn't changed
                if (node.data?.status === status) {
                    return node;
                }
                return {
                    ...node,
                    data: {
                        ...node.data,
                        status: status, // Add/update status in node data
                    },
                };
            })
        );
    }, [nodeExecutionStatus, setNodes]); // Rerun when status map changes

    // Helper function to create edges between model config and LLM nodes
    const createModelConfigEdge = useCallback((modelConfigId, llmNodeId) => {
        // Check if edge already exists
        const edgeExists = edges.some(edge =>
            (edge.source === modelConfigId && edge.target === llmNodeId) ||
            (edge.source === llmNodeId && edge.target === modelConfigId)
        );

        if (!edgeExists) {
            const newEdge = {
                id: `edge-${modelConfigId}-${llmNodeId}`,
                source: modelConfigId,
                target: llmNodeId,
                type: 'modelConfig',
                animated: true
            };

            setEdges(prevEdges => [...prevEdges, newEdge]);
        }
    }, [edges, setEdges]);

    // Helper function to remove edges between model config and LLM nodes
    const removeModelConfigEdge = useCallback((modelConfigId, llmNodeId) => {
        setEdges(prevEdges => prevEdges.filter(edge => {
            // Filter out any edge connecting these two nodes in either direction
            return !((edge.source === modelConfigId && edge.target === llmNodeId) ||
                (edge.source === llmNodeId && edge.target === modelConfigId));
        }));
    }, [setEdges]);

    // Custom edges change handler to update nodes when model config edges are removed
    const handleEdgesChange = useCallback((changes) => {
        // Process the changes first to identify edge removals
        const removedEdges = [];

        changes.forEach(change => {
            if (change.type === 'remove') {
                const edge = edges.find(e => e.id === change.id);
                if (edge) {
                    removedEdges.push(edge);
                }
            }
        });

        // Now handle edge removals that involve model config nodes
        if (removedEdges.length > 0) {
            // Create a new copy of nodes
            const newNodes = [...nodes];
            let nodesUpdated = false;

            // Look for edges that connect a model_config node to an llm node
            for (const edge of removedEdges) {
                const sourceNode = nodes.find(node => node.id === edge.source);
                const targetNode = nodes.find(node => node.id === edge.target);

                if (sourceNode?.type === 'model_config' && targetNode?.type === 'llm') {
                    // This edge connects a model config to an LLM node
                    // When removed, clear the model_config_id in the LLM node
                    const targetNodeIndex = newNodes.findIndex(node => node.id === targetNode.id);
                    if (targetNodeIndex !== -1 && newNodes[targetNodeIndex].data.model_config_id) {
                        newNodes[targetNodeIndex] = {
                            ...newNodes[targetNodeIndex],
                            data: {
                                ...newNodes[targetNodeIndex].data,
                                model_config_id: null
                            }
                        };
                        nodesUpdated = true;
                    }
                }
            }

            // Only update nodes if we made changes
            if (nodesUpdated) {
                setNodes(newNodes);
            }
        }

        // Let the standard edge changes happen
        setEdges(eds => applyEdgeChanges(changes, eds));
    }, [edges, nodes, setEdges, setNodes]);

    // Add this effect to poll for webhook updates
    useEffect(() => {
        // Only poll if there are webhook_trigger nodes in the workflow
        const webhookNodes = nodes.filter(node =>
            node.type === 'webhook_trigger' &&
            node.data?.webhook_id &&
            !node.data?.registering &&
            !node.data?.needsRegistration
        );

        if (webhookNodes.length === 0 || !workflowId) return;

        // Poll every 2 seconds (changed from 5 seconds for faster updates)
        const intervalId = setInterval(async () => {
            try {
                console.log("Polling for webhook updates...");
                // Fetch the current workflow to get latest node data
                const response = await axios.get(`/api/workflows/${workflowId}`);
                const updatedWorkflow = response.data;

                if (!updatedWorkflow || !updatedWorkflow.nodes) return;

                // Check each webhook node for updates
                let hasUpdates = false;

                // Update nodes with any changes
                setNodes(oldNodes => {
                    // Create a copy of nodes to avoid reference issues
                    const newNodes = [...oldNodes];

                    // Process each webhook node
                    for (const node of newNodes) {
                        if (node.type !== 'webhook_trigger' || !node.data?.webhook_id) continue;

                        // Find corresponding node in updated workflow
                        const updatedNode = updatedWorkflow.nodes.find(n => n.id === node.id);
                        if (!updatedNode) continue;

                        // Check if there's a new payload or an updated payload
                        const hasNewPayload =
                            (updatedNode.data?.last_payload && !node.data?.last_payload) ||
                            (updatedNode.data?.last_payload && node.data?.last_payload &&
                                JSON.stringify(updatedNode.data.last_payload) !== JSON.stringify(node.data.last_payload));

                        if (hasNewPayload) {
                            console.log(`Node ${node.id} has new webhook data:`, updatedNode.data.last_payload);
                            hasUpdates = true;

                            // Update the node with new data
                            node.data = {
                                ...node.data,
                                last_payload: updatedNode.data.last_payload
                            };
                        }
                    }

                    return hasUpdates ? newNodes : oldNodes;
                });

            } catch (error) {
                console.error("Error polling for webhook updates:", error);
            }
        }, 2000);

        return () => clearInterval(intervalId);
    }, [nodes, workflowId]);

    // Add a function to manually fetch webhook data for debugging
    const forceWebhookRefresh = async () => {
        if (!workflowId) {
            alert("Please save your workflow first.");
            return;
        }

        try {
            console.log("Forcing webhook data refresh...");

            // First get the webhook debug info to see all payloads and mappings
            const webhookDebugResponse = await axios.get('/api/webhooks/debug');
            const webhookData = webhookDebugResponse.data;
            console.log("Current webhook mappings:", webhookData.webhook_mappings);
            console.log("Current webhook payloads:", webhookData.webhook_payloads);

            // Fetch the current workflow to get latest node data
            const response = await axios.get(`/api/workflows/${workflowId}`);
            const updatedWorkflow = response.data;

            if (!updatedWorkflow || !updatedWorkflow.nodes) {
                alert("No workflow data found");
                return;
            }

            // Find all webhook nodes and update them
            let hasUpdates = false;

            // Get current webhook nodes in this workflow
            const webhookNodes = nodes.filter(n => n.type === 'webhook_trigger');

            if (webhookNodes.length === 0) {
                alert("No webhook trigger nodes found in this workflow.");
                return;
            }

            console.log("Webhook nodes in current workflow:", webhookNodes.map(n => ({ id: n.id, data: n.data })));

            // Create a map of webhook mappings for this workflow
            const workflowWebhooks = {};
            Object.entries(webhookData.webhook_mappings).forEach(([webhookId, mapping]) => {
                if (mapping.workflow_id === workflowId) {
                    if (!workflowWebhooks[mapping.node_id]) {
                        workflowWebhooks[mapping.node_id] = [];
                    }
                    workflowWebhooks[mapping.node_id].push({
                        webhookId,
                        payload: webhookData.webhook_payloads[webhookId]
                    });
                }
            });

            console.log("Webhook mappings for this workflow:", workflowWebhooks);

            // Update nodes with webhook data
            const updatedNodes = nodes.map(node => {
                if (node.type === 'webhook_trigger') {
                    console.log(`Processing node ${node.id}, webhook_id: ${node.data?.webhook_id}`);

                    // Find webhooks for this node
                    const nodeWebhooks = workflowWebhooks[node.id] || [];
                    if (nodeWebhooks.length > 0) {
                        // Use the most recent webhook payload
                        const latestWebhook = nodeWebhooks[nodeWebhooks.length - 1];
                        if (latestWebhook.payload) {
                            console.log(`Found payload for node ${node.id}:`, latestWebhook.payload);

                            // Check if this is new data
                            const isNewData = JSON.stringify(node.data?.last_payload) !== JSON.stringify(latestWebhook.payload);

                            if (isNewData) {
                                hasUpdates = true;
                                return {
                                    ...node,
                                    data: {
                                        ...node.data,
                                        last_payload: latestWebhook.payload,
                                        webhook_id: node.data?.webhook_id || latestWebhook.webhookId
                                    }
                                };
                            }
                        }
                    } else if (node.data?.webhook_id) {
                        // Check if there's data for this specific webhook_id
                        const webhookPayload = webhookData.webhook_payloads[node.data.webhook_id];
                        if (webhookPayload) {
                            console.log(`Found payload for webhook_id ${node.data.webhook_id}:`, webhookPayload);

                            // Check if this is new data
                            const isNewData = JSON.stringify(node.data?.last_payload) !== JSON.stringify(webhookPayload);

                            if (isNewData) {
                                hasUpdates = true;
                                return {
                                    ...node,
                                    data: {
                                        ...node.data,
                                        last_payload: webhookPayload
                                    }
                                };
                            }
                        }
                    }
                }
                return node;
            });

            if (hasUpdates) {
                console.log("Manually updating nodes with webhook data");
                setNodes(updatedNodes);
                alert("Webhook data refreshed successfully!");
            } else {
                console.log("No webhook updates found");
                alert("No new webhook data found. The webhook may not be correctly mapped to this node.");
            }
        } catch (error) {
            console.error('Error manually refreshing webhook data:', error);
            alert("Error refreshing webhook data: " + error.message);
        }
    };

    // Create the node types with the updateNodeData function
    const currentNodeTypes = React.useMemo(() => getNodeTypes(updateNodeData), [updateNodeData]);

    // Fetch workflow details & update activation status
    useEffect(() => {
        if (workflowId) {
            const fetchWorkflowDetails = async () => {
                try {
                    const response = await axios.get(`/api/workflows/${workflowId}`);
                    const workflowData = response.data;

                    // Update activation status from the fetched workflow
                    setIsWorkflowActive(workflowData.is_active || false);
                    setIsWorkflowTested(workflowData.tested || false);
                    setLastTestedDate(workflowData.last_tested || null);

                } catch (error) {
                    console.error("Error fetching workflow details:", error);
                }
            };

            fetchWorkflowDetails();
        }
    }, [workflowId]);

    // Handle workflow activation toggle
    const handleToggleActivation = async () => {
        if (!workflowId) {
            alert("Please save the workflow first.");
            return;
        }

        // Don't allow activation if not tested
        if (!isWorkflowActive && !isWorkflowTested) {
            alert("You must successfully test the workflow before activating it.");
            return;
        }

        try {
            const response = await axios.post(`/api/workflows/${workflowId}/toggle_active`, {
                active: !isWorkflowActive
            });

            setIsWorkflowActive(!isWorkflowActive);
            alert(`Workflow ${!isWorkflowActive ? 'activated' : 'deactivated'} successfully!`);
        } catch (error) {
            console.error("Error toggling workflow activation:", error);
            alert(`Error: ${error.response?.data?.detail || error.message}`);
        }
    };

    // Test the entire workflow
    const handleTestWorkflow = async () => {
        if (!workflowId) {
            alert("Please save the workflow first.");
            return;
        }

        // Check for validation errors
        const errors = validateWorkflow();
        const errorCount = Object.keys(errors).length;

        if (errorCount > 0) {
            alert(`Cannot test workflow: ${errorCount} node${errorCount > 1 ? 's have' : ' has'} validation errors. Please fix them first.`);
            return;
        }

        setIsTestingWorkflow(true);

        try {
            // Start the test
            const response = await axios.post(`/api/workflows/${workflowId}/test`);
            const runId = response.data.run_id;

            if (!runId) throw new Error("Backend did not return a run_id.");

            // Clear previous logs and statuses
            setRunLogs([]); // Clear logs immediately
            setNodeExecutionStatus({}); // Clear node statuses

            // Add initial entry
            setRunLogs([{
                step: "Initiating Test Run...",
                status: "Pending",
                timestamp: Date.now() / 1000,
                is_test: true
            }]);

            // Setup SSE connection for monitoring the test
            if (eventSourceRef.current) {
                console.log("Closing previous SSE connection.");
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }

            console.log(`Obtained test run_id: ${runId}. Connecting to SSE stream...`);

            const sseUrl = `/api/workflows/${workflowId}/runs/${runId}/stream`;
            const newEventSource = new EventSource(sseUrl);
            eventSourceRef.current = newEventSource;

            newEventSource.onmessage = (event) => {
                try {
                    const logEntry = JSON.parse(event.data);

                    if (logEntry.step === "__END__") {
                        newEventSource.close();
                        eventSourceRef.current = null;
                        setIsTestingWorkflow(false);

                        // Fetch workflow details again to update tested status
                        const fetchWorkflowDetails = async () => {
                            try {
                                const response = await axios.get(`/api/workflows/${workflowId}`);
                                const workflowData = response.data;

                                setIsWorkflowTested(workflowData.tested || false);
                                setLastTestedDate(workflowData.last_tested || null);

                                // If test was successful, show a message
                                if (workflowData.tested) {
                                    alert("Workflow tested successfully! You can now activate it.");
                                }
                            } catch (error) {
                                console.error("Error fetching workflow details after test:", error);
                            }
                        };

                        fetchWorkflowDetails();
                        return;
                    }

                    // Update logs
                    setRunLogs(prev => [...prev, logEntry]);

                    // Update node status based on log entry
                    if (logEntry.node_id) {
                        setNodeExecutionStatus(prevStatus => ({
                            ...prevStatus,
                            [logEntry.node_id]: logEntry.status || 'Unknown'
                        }));
                    }

                    // If it's the final step, don't clear right away to let the user see the results
                    if (logEntry.step === 'End') {
                        // Keep statuses visible for a while
                        setTimeout(() => setNodeExecutionStatus({}), 5000);
                    }

                } catch (error) {
                    console.error("Error parsing SSE test data:", error);
                    setIsTestingWorkflow(false);
                }
            };

            newEventSource.onerror = (error) => {
                console.error("SSE test connection error:", error);
                setIsTestingWorkflow(false);
                if (newEventSource) newEventSource.close();
                eventSourceRef.current = null;
            };

        } catch (error) {
            console.error("Error testing workflow:", error);
            setIsTestingWorkflow(false);
            alert(`Error: ${error.response?.data?.detail || error.message}`);
        }
    };

    // Update edges based on node execution status
    useEffect(() => {
        // Only update edges if there's execution status info
        if (Object.keys(nodeExecutionStatus).length === 0) {
            // Reset all edges to default style
            setEdges(eds =>
                eds.map(edge => ({
                    ...edge,
                    style: defaultEdgeOptions.style,
                    animated: defaultEdgeOptions.animated,
                }))
            );
            return;
        }

        // Find which edges should be highlighted based on node execution
        setEdges(eds =>
            eds.map(edge => {
                const sourceStatus = nodeExecutionStatus[edge.source];
                const targetStatus = nodeExecutionStatus[edge.target];

                // Edge is active if source is done and target is running or pending
                if (sourceStatus === 'Success' &&
                    (targetStatus === 'Running' || targetStatus === 'Pending')) {
                    const style = getEdgeStyleForStatus('Running');
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: style.stroke,
                            strokeWidth: style.strokeWidth,
                        },
                        animated: style.animated,
                    };
                }

                // Edge is successful if both source and target are successful
                if (sourceStatus === 'Success' && targetStatus === 'Success') {
                    const style = getEdgeStyleForStatus('Success');
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: style.stroke,
                            strokeWidth: style.strokeWidth,
                        },
                        animated: style.animated,
                    };
                }

                // Edge has failed if source succeeded but target failed
                if (sourceStatus === 'Success' && targetStatus === 'Failed') {
                    const style = getEdgeStyleForStatus('Failed');
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: style.stroke,
                            strokeWidth: style.strokeWidth,
                        },
                        animated: style.animated,
                    };
                }

                // Edge is waiting
                if (sourceStatus === 'Success' && targetStatus === 'Waiting') {
                    const style = getEdgeStyleForStatus('Waiting');
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: style.stroke,
                            strokeWidth: style.strokeWidth,
                            strokeDasharray: style.strokeDasharray,
                        },
                        animated: style.animated,
                    };
                }

                // Default - no change to edge
                return edge;
            })
        );
    }, [nodeExecutionStatus, setEdges]);

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            {/* Left Node Palette Drawer */}
            <Drawer
                variant="permanent"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
                }}
            >
                <Toolbar /> { /* Spacer to push content below AppBar */}
                <Box sx={{ overflow: 'auto', padding: '8px' }}>
                    <Typography variant="h6" sx={{ padding: '8px 16px', mb: 1 }}>Nodes</Typography>
                    <Divider sx={{ mb: 2 }} />
                    {Object.entries(getNodesByCategory()).map(([category, nodes]) => (
                        <Box
                            key={category}
                            sx={{
                                mb: 2,
                                backgroundColor: 'rgba(0,0,0,0.02)',
                                borderRadius: '8px',
                                overflow: 'hidden'
                            }}
                        >
                            <Box
                                onClick={() => toggleCategory(category)}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    backgroundColor: 'rgba(0,0,0,0.03)',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0,0,0,0.05)',
                                    }
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Box sx={{ mr: 1 }}>{getCategoryIcon(category)}</Box>
                                    <Typography
                                        variant="subtitle2"
                                        sx={{
                                            padding: '6px 8px',
                                            color: 'text.secondary',
                                            fontWeight: 'bold',
                                            fontSize: '0.75rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                        }}
                                    >
                                        {category}
                                    </Typography>
                                </Box>
                                {expandedCategories[category] ?
                                    <ExpandLessIcon fontSize="small" color="action" /> :
                                    <ExpandMoreIcon fontSize="small" color="action" />
                                }
                            </Box>
                            {expandedCategories[category] && (
                                <List dense sx={{ pt: 1, pb: 1 }}>
                                    {nodes.map((nodeInfo) => (
                                        <ListItem key={nodeInfo.type} disablePadding>
                                            <ListItemButton
                                                onDragStart={(event) => onDragStart(event, nodeInfo.type)}
                                                draggable
                                                sx={{
                                                    border: '1px dashed #ccc',
                                                    marginBottom: '6px',
                                                    marginLeft: '8px',
                                                    marginRight: '8px',
                                                    borderRadius: '4px',
                                                    '&:hover': {
                                                        backgroundColor: 'rgba(66, 133, 244, 0.04)',
                                                        borderColor: '#b3d1ff'
                                                    }
                                                }}
                                            >
                                                <ListItemIcon sx={{ minWidth: '40px' }}>
                                                    {getNodeIcon(nodeInfo.type)}
                                                </ListItemIcon>
                                                <ListItemText primary={nodeInfo.label} />
                                            </ListItemButton>
                                        </ListItem>
                                    ))}
                                </List>
                            )}
                        </Box>
                    ))}
                </Box>
            </Drawer>

            {/* Main Content Area */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    bgcolor: 'background.default',
                }}
            >
                {/* Top AppBar */}
                <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
                    <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        {/* Left side: Title */}
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <AccountTreeIcon sx={{ mr: 2 }} />
                            <Typography variant="h6" noWrap component="div">
                                Mini Workflow Engine
                            </Typography>
                        </Box>

                        {/* Center: Workflow Name & Load */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TextField
                                label="Workflow Name"
                                variant="outlined"
                                size="small"
                                value={workflowName}
                                onChange={(e) => setWorkflowName(e.target.value)}
                                sx={{ mr: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1, input: { color: 'white' }, label: { color: '#eee' } }}
                            />
                            <FormControl variant="outlined" size="small" sx={{ mr: 1, minWidth: 200, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1 }}>
                                <InputLabel id="workflow-select-label" sx={{ color: '#eee' }}>Select Workflow</InputLabel>
                                <Select labelId="workflow-select-label" value={selectedWorkflowId} onChange={(e) => setSelectedWorkflowId(e.target.value)} label="Select Workflow" sx={{ color: 'white' }}>
                                    <MenuItem value=""><em>None</em></MenuItem>
                                    {availableWorkflows.map((wf) => <MenuItem key={wf.id} value={wf.id}>{wf.name} ({wf.id})</MenuItem>)}
                                </Select>
                            </FormControl>
                            <Button variant="outlined" size="small" onClick={fetchWorkflows} sx={{ mr: 1, color: 'white', borderColor: 'rgba(255,255,255,0.5)' }}><RefreshIcon fontSize="small" /></Button>
                            <Button variant="contained" startIcon={<FolderOpenIcon />} onClick={handleLoadWorkflow}>Load</Button>
                            <Button variant="contained" color="secondary" startIcon={<SaveIcon />} onClick={handleSaveWorkflow} sx={{ ml: 1 }}>Save</Button>
                        </Box>

                        {/* Right side: Actions (Run, Test, Activate) */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Tooltip title="Run the workflow operationally. Requires workflow to be Active if triggered by webhook.">
                                <span> {/* Span needed for disabled button tooltip */}
                                    <Button
                                        variant="contained"
                                        color="success"
                                        startIcon={<PlayArrowIcon />}
                                        onClick={handleRunWorkflow}
                                        disabled={!workflowId || isTestingWorkflow} // Disable if no workflow or currently testing
                                    >
                                        Run Workflow
                                    </Button>
                                </span>
                            </Tooltip>
                            <Tooltip title="Test the full workflow logic. Waits for webhook data if needed. Marks workflow as tested on success.">
                                <span>
                                    <Button
                                        variant="outlined"
                                        color="info"
                                        startIcon={<ScienceIcon />} // Changed icon
                                        onClick={handleTestWorkflow}
                                        disabled={!workflowId || isTestingWorkflow}
                                        sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.7)' }}
                                    >
                                        Test Workflow
                                    </Button>
                                </span>
                            </Tooltip>
                            <Tooltip title={!isWorkflowTested ? "Workflow must be tested successfully first" : (isWorkflowActive ? "Deactivate Workflow" : "Activate Workflow")}>
                                <span>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={isWorkflowActive}
                                                onChange={handleToggleActivation}
                                                disabled={!isWorkflowTested || !workflowId || isTestingWorkflow}
                                                color="success"
                                            />
                                        }
                                        label={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                {isWorkflowActive ? <CloudDoneIcon color="success" /> : <CloudOffIcon color="disabled" />}
                                                <Typography variant="body2">{isWorkflowActive ? "Active" : "Inactive"}</Typography>
                                            </Box>
                                        }
                                        sx={{ color: 'white' }}
                                    />
                                </span>
                            </Tooltip>
                        </Box>
                    </Toolbar>
                </AppBar>

                {/* Testing progress indicator */}
                {isTestingWorkflow && (
                    <LinearProgress color="info" />
                )}

                {/* Test status indicators */}
                {workflowId && (
                    <Box sx={{ p: 1, borderBottom: '1px solid #e0e0e0', backgroundColor: '#f5f5f5' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {isWorkflowTested ? (
                                <Alert
                                    icon={<CheckCircleIcon fontSize="inherit" />}
                                    severity="success"
                                    sx={{ py: 0 }}
                                >
                                    Workflow tested successfully
                                    {lastTestedDate && ` on ${new Date(lastTestedDate).toLocaleString()}`}
                                </Alert>
                            ) : (
                                <Alert
                                    severity="warning"
                                    sx={{ py: 0 }}
                                >
                                    Workflow not tested yet. Test the workflow before activating.
                                </Alert>
                            )}
                        </Box>
                    </Box>
                )}

                {/* React Flow Editor Area */}
                <Box
                    ref={reactFlowWrapper}
                    sx={{
                        flexGrow: 1,
                        minHeight: 0, // Key to allow parent container to limit the height
                        position: 'relative'
                    }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={handleEdgesChange}
                        onConnect={onConnect}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        nodeTypes={currentNodeTypes}
                        edgeTypes={edgeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        defaultViewport={defaultViewport}
                        fitView
                        onNodeClick={onNodeClick}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onPaneClick={onPaneClick}
                        proOptions={{ hideAttribution: true }}
                        selectNodesOnDrag={false}
                        nodeDragThreshold={1}
                        nodesFocusable={true}
                        elementsSelectable={true}
                    >
                        <Controls />
                        <MiniMap
                            style={{ height: 120 }}
                            zoomable
                            pannable
                        />
                        <Background color="#aaa" gap={16} />
                    </ReactFlow>
                </Box>

                {/* Log Panel at Bottom */}
                <Paper
                    elevation={3}
                    square
                    sx={{
                        height: `${logPanelHeight}px`,
                        width: '100%',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        flexShrink: 0,
                    }}
                >
                    <LogDisplay logs={runLogs} />
                </Paper>
            </Box>

            {/* Node Configuration Panel (Modal) */}
            <NodeConfigPanel
                node={configNode}
                nodes={nodes}
                onUpdate={updateNodeData}
                onClose={() => setConfigNode(null)}
                open={!!configNode}
                onCreateEdge={createModelConfigEdge}
                onRemoveEdge={removeModelConfigEdge}
                workflowId={workflowId}
                edges={edges}
            />
        </Box>
    );
}

// Wrap with ReactFlowProvider to use hooks like useReactFlow
function WorkflowEditorWrapper() {
    return (
        <ReactFlowProvider>
            <WorkflowEditor />
        </ReactFlowProvider>
    );
}

export default WorkflowEditorWrapper; 