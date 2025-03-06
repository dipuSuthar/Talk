import React, { useState } from "react";
import {
  Button,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  VStack,
  Avatar,
} from "@chakra-ui/react";
import { ViewIcon, ViewOffIcon } from "@chakra-ui/icons";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const SignUp = () => {
  const navigate = useNavigate();
  const [Name, setName] = useState("");
  const [Email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPassword, setshowPassword] = useState(false);
  const [pic, setPic] = useState(null);
  const [loading, setloading] = useState(false);
  const handlesubmit = () => {
    setloading(!loading);
  };

  const Registration = async () => {
    try {
      setloading(true);
      const formData = new FormData();
      formData.append("name", Name);
      formData.append("email", Email);
      formData.append("password", password);
      formData.append("pic", pic); // Ensure 'pic' is a File object

      const url = "http://localhost:8000/api/user/register";
      const response = await axios.post(url, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 10000,
        method: "POST",
      });

      if (response) {
        localStorage.setItem("userInfo", JSON.stringify(response.data));
        console.log(response.data.token);
        navigate("/chats");
      } else {
        throw new Error("Network response was not ok");
      }
      setloading(false);
      console.log(response);
    } catch (error) {
      console.error("There was a problem with the fetch operation:", error);
      setloading(false);
    }
  };

  return (
    <VStack spacing="4px">
      <Avatar isRequired size="2xl" src={pic ? URL.createObjectURL(pic) : ""} />
      <FormControl id="pic" isRequired>
        <FormLabel>Upload your profile</FormLabel>
        <Input
          type="file"
          p={1.5}
          accept="image/**"
          placeholder="Enter Your profile"
          onChange={(e) => setPic(e.target.files[0])}
        />
      </FormControl>
      <FormControl id="name" isRequired>
        <FormLabel>Name</FormLabel>
        <Input
          placeholder="Enter Your Name"
          onChange={(e) => setName(e.target.value)}
        />
      </FormControl>
      <FormControl id="email" isRequired>
        <FormLabel>Email</FormLabel>
        <Input
          type="email"
          placeholder="Enter Your Email"
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormControl>
      <FormControl id="password" isRequired>
        <FormLabel>Password</FormLabel>
        <InputGroup>
          <Input
            type={!showPassword ? "password" : "text"}
            placeholder="Enter Your Password"
            onChange={(e) => setPassword(e.target.value.trim())}
          />
          <InputRightElement>
            {showPassword ? (
              <IconButton onClick={() => setshowPassword(!showPassword)}>
                <ViewOffIcon />
              </IconButton>
            ) : (
              <IconButton onClick={() => setshowPassword(!showPassword)}>
                <ViewIcon />
              </IconButton>
            )}
          </InputRightElement>
        </InputGroup>
      </FormControl>
      <FormControl id="Confirmpassword" isRequired>
        <FormLabel>Confirm Password</FormLabel>
        <InputGroup>
          <Input
            type={!showConfirmPassword ? "password" : "text"}
            placeholder="Enter Your  Confirm Password"
            onChange={(e) => setConfirmPassword(e.target.value.trim())}
          />
          <InputRightElement>
            {showConfirmPassword ? (
              <IconButton
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <ViewOffIcon />
              </IconButton>
            ) : (
              <IconButton
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <ViewIcon />
              </IconButton>
            )}
          </InputRightElement>
        </InputGroup>
      </FormControl>
      <Button
        width="100%"
        isLoading={loading}
        loadingText="Submitting"
        backgroundColor="#bee3f8"
        variant="solid"
        onClick={Registration}
      >
        Submit
      </Button>
    </VStack>
  );
};

export default SignUp;
