import { AddIcon } from "@chakra-ui/icons";
import {
  Box,
  Stack,
  Text,
  useToast,
  Button,
  Badge,
  Avatar,
} from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useState } from "react";
import ChatLoading from "./ChatLoading";
import { ChatState } from "../Context/ChatProvider";
import { getSender } from "../Config/ChatLogics";
import GroupChatModal from "../miscellaneous/GroupChatModel";

const MyChats = ({ fetchAgain }) => {
  const [loggedUser, setLoggedUser] = useState();

  const {
    selectedChat,
    setSelectedChat,
    user,
    chats,
    setChats,
    notification,
    setNotification,
  } = ChatState();

  const toast = useToast();

  const fetchChats = async () => {
    console.log(user.token);
    try {
      const config = {
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${user.token}`,
        },
      };

      const { data } = await axios.get(
        "http://localhost:8000/api/chat",
        config
      );
      setChats(data);
    } catch (error) {
      toast({
        title: "Error Occured!",
        description: "Failed to Load the chats",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "bottom-left",
      });
    }
  };

  useEffect(() => {
    setLoggedUser(JSON.parse(localStorage.getItem("userInfo")));
    fetchChats();
    // eslint-disable-next-line
  }, [fetchAgain]);

  console.log(notification);
  console.log(chats);
  const handleUnreadCount = (chatId) => {
    let count = 0; // Initialize count

    notification.forEach((noti) => {
      if (noti.chat._id === chatId) {
        count += 1;
      }
    });

    return count !== 0 ? count : null;
  };

  return (
    <Box
      style={{
        // display: selectedChat ? "none" : "flex", // Default for base (mobile)
        flexDirection: "column",
        alignItems: "center",
        padding: "12px",
        backgroundColor: "white",
        width: window.innerWidth >= 768 ? "31%" : "100%", // Mimics Chakra's `w={{ base: "100%", md: "31%" }}`
        borderRadius: "8px",
        borderWidth: "1px",
      }}
    >
      <Box
        pb={3}
        px={3}
        fontSize={{ base: "28px", md: "30px" }}
        fontFamily="Work sans"
        d="flex"
        w="100%"
        justifyContent="space-between"
        alignItems="center"
      >
        My Chats
        <GroupChatModal>
          <Button
            style={{
              display: "flex",
              float: "right",
            }}
            fontSize={{ base: "17px", md: "10px", lg: "17px" }}
            rightIcon={<AddIcon />}
          >
            New Group Chat
          </Button>
        </GroupChatModal>
      </Box>
      <Box
        d="flex"
        flexDir="column"
        p={3}
        bg="#F8F8F8"
        w="100%"
        borderRadius="lg"
        overflow="hidden"
      >
        {chats ? (
          <Stack overflowY="scroll">
            {chats.map((chat) => (
              <Box
                key={chat._id}
                onClick={() => {
                  setSelectedChat(chat);
                  setNotification(
                    notification.filter((n) => n.chat._id !== chat._id)
                  );
                }}
                cursor="pointer"
                bg={selectedChat === chat ? "#38B2AC" : "#E8E8E8"}
                color={selectedChat === chat ? "white" : "black"}
                px={3}
                py={2}
                borderRadius="lg"
              >
                {/* Flexbox for Avatar, Name & Badge */}
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box display="flex" alignItems="center">
                    <Avatar
                      style={{
                        height: "40px",
                        width: "40px",
                        fontSize: "10px",
                      }}
                      src=""
                      name={
                        !chat.isGroupChat
                          ? getSender(loggedUser, chat.users)
                          : chat.chatName
                      }
                      color="white"
                      mr={2}
                    />
                    <Text fontWeight="bold">
                      {!chat.isGroupChat
                        ? getSender(loggedUser, chat.users)
                        : chat.chatName}
                    </Text>
                  </Box>

                  {/* Unread Chat Count Badge */}
                  <Badge
                    bg="red.500"
                    color="white"
                    borderRadius="full"
                    fontSize="0.8em"
                    px={2}
                    display={handleUnreadCount(chat._id) > 0 ? "block" : "none"}
                  >
                    {handleUnreadCount(chat._id)}
                  </Badge>
                </Box>

                {/* Latest Message below Name */}
                {chat.latestMessage && (
                  <Text fontSize="10px" color="gray.600" ml={16}>
                    <b>{chat.latestMessage.sender.name}:</b>{" "}
                    {chat.latestMessage.content.length > 50
                      ? chat.latestMessage.content.substring(0, 51) + "..."
                      : chat.latestMessage.content}
                  </Text>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <ChatLoading />
        )}
      </Box>
    </Box>
  );
};

export default MyChats;
